//! PICTOS browser binding for the VTracer 1.0 core.
//!
//! A `TraceSession` segments an RGBA image once (the expensive step) and can
//! then `finish` it many times with different curve settings. Every region is
//! identified by its layer index in the cached segmentation, and every traced
//! path names the region it came from: provenance is explicit, never inferred
//! from output order (the core drops empty shapes and carries no ids).
//!
//! Semantic safety: the pipeline is built by hand with the `Identity` color
//! fitter and neighbour merging disabled, so no palette snap or merge can fuse
//! two regions behind PICTOS's back.
//!
//! Compositing: `mosaic` (default) is a visible partition with shared,
//! seam-free boundaries; each path is the part of a region that is actually
//! visible, and a fully covered region yields no path. `stacked` traces each
//! region's whole mask, painted bottom to top. Units are the core's own
//! (`filter_speckle` in px side length, `corner_threshold` in degrees); this
//! binding never re-converts them.

use serde::{Deserialize, Serialize};
use vtracer::colorfit::Identity;
use vtracer::ir::Paint;
use vtracer::compose::Compositing;
use vtracer::ir::{Layer, Segmentation, Shape, VectorDoc};
use vtracer::svg::SvgWriter;
use vtracer::{Color, ColorImage, Config, Hierarchical, Pipeline};
use wasm_bindgen::prelude::*;

/// Options accepted from JS (camelCase). Omitted = core default.
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Options {
    clustering: Option<String>,
    /// "mosaic" (default) | "stacked".
    compositing: Option<String>,
    mode: Option<String>,
    filter_speckle: Option<usize>,
    color_precision: Option<i32>,
    layer_difference: Option<i32>,
    corner_threshold: Option<i32>,
    length_threshold: Option<f64>,
    splice_threshold: Option<i32>,
    /// Curve simplification tolerance in px (omit = off).
    simplify: Option<f64>,
    path_precision: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegionInfo {
    region_id: usize,
    color: String,
    bbox: [i32; 4],
    area: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TracedPath {
    region_id: usize,
    color: String,
    d: String,
}

fn err(msg: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&msg.to_string())
}

fn config_from(options: JsValue) -> Result<Config, JsValue> {
    let o: Options = if options.is_undefined() || options.is_null() {
        Options::default()
    } else {
        serde_wasm_bindgen::from_value(options).map_err(err)?
    };
    let mut c = Config::default();
    if let Some(v) = o.clustering { c.clustering = v.parse().map_err(err)?; }
    c.hierarchical = match o.compositing.as_deref() {
        None | Some("mosaic") => Hierarchical::Cutout,
        Some("stacked") => Hierarchical::Stacked,
        Some(other) => return Err(err(format!("unknown compositing `{other}`"))),
    };
    if let Some(v) = o.mode { c.mode = v.parse().map_err(err)?; }
    if let Some(v) = o.filter_speckle { c.filter_speckle = v; }
    if let Some(v) = o.color_precision { c.color_precision = v; }
    if let Some(v) = o.layer_difference { c.layer_difference = v; }
    if let Some(v) = o.corner_threshold { c.corner_threshold = v; }
    if let Some(v) = o.length_threshold { c.length_threshold = v; }
    if let Some(v) = o.splice_threshold { c.splice_threshold = v; }
    c.simplify = o.simplify;
    c.path_precision = o.path_precision.or(Some(2));
    c.optimize = 0; // keep absolute coordinates for local geometry
    Ok(c)
}

/// Identity-colored pipeline with neighbour merging disabled.
fn safe_pipeline(config: &Config) -> Result<Pipeline, JsValue> {
    let mut p = config.build().map_err(err)?;
    p.color_fitters = vec![Box::new(Identity)];
    if let Compositing::Mosaic { merge_diff, .. } = &mut p.compositing {
        *merge_diff = -1;
    }
    Ok(p)
}

/// Mosaic shapes carry only a paint, so each layer is painted with its own
/// index for the run and the index is read back from the output.
fn index_paint(i: usize) -> Paint {
    Paint::Solid(Color::new((i >> 16) as u8, (i >> 8) as u8, i as u8))
}

fn paint_index(p: &Paint) -> usize {
    let c = p.color();
    ((c.r as usize) << 16) | ((c.g as usize) << 8) | c.b as usize
}

fn hex(layer: &Layer) -> String {
    layer.paint.color().to_hex_string()
}

/// The single `d` the writer emits for a one-shape document.
fn path_d(writer: &SvgWriter, width: u32, height: u32, shape: Shape) -> Option<String> {
    let mut doc = VectorDoc::new(width, height);
    doc.shapes.push(shape);
    let svg = writer.write(&doc);
    let start = svg.find(" d=\"")? + 4;
    let end = start + svg[start..].find('"')?;
    Some(svg[start..end].to_string())
}

#[wasm_bindgen]
pub struct TraceSession {
    seg: Segmentation,
}

#[wasm_bindgen]
impl TraceSession {
    /// Segment a raw RGBA8 buffer (`width * height * 4` bytes).
    #[wasm_bindgen(constructor)]
    pub fn new(rgba: Vec<u8>, width: usize, height: usize, options: JsValue) -> Result<TraceSession, JsValue> {
        if rgba.len() != width * height * 4 {
            return Err(err(format!("rgba length {} != width*height*4 ({})", rgba.len(), width * height * 4)));
        }
        let config = config_from(options)?;
        let img = ColorImage { pixels: rgba, width, height };
        let seg = safe_pipeline(&config)?.segment(&img).map_err(err)?;
        Ok(TraceSession { seg })
    }

    pub fn width(&self) -> u32 { self.seg.width }
    pub fn height(&self) -> u32 { self.seg.height }

    /// Regions in paint order (bottom to top): id, colour, bbox, pixel area.
    pub fn regions(&self) -> Result<JsValue, JsValue> {
        let list: Vec<RegionInfo> = self.seg.layers.iter().enumerate().map(|(i, l)| RegionInfo {
            region_id: i,
            color: hex(l),
            bbox: [l.mask.offset.x, l.mask.offset.y, l.mask.width() as i32, l.mask.height() as i32],
            area: l.mask.area(),
        }).collect();
        serde_wasm_bindgen::to_value(&list).map_err(err)
    }

    /// A region's coverage inside its bbox, row-major, 1 = inside.
    pub fn region_mask(&self, region_id: usize) -> Result<Vec<u8>, JsValue> {
        let l = self.seg.layers.get(region_id).ok_or_else(|| err("unknown region"))?;
        let (w, h) = (l.mask.width(), l.mask.height());
        let mut out = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                if l.mask.image.get_pixel(x, y) { out[y * w + x] = 1; }
            }
        }
        Ok(out)
    }

    /// Trace every region with the given curve options (clustering options are
    /// ignored: the cached segmentation is reused). Each path names its region;
    /// a region may yield several paths (disjoint visible islands in mosaic)
    /// or none (empty, or fully covered in mosaic).
    pub fn finish(&self, options: JsValue) -> Result<JsValue, JsValue> {
        let config = config_from(options)?;
        let pipeline = safe_pipeline(&config)?;
        let writer = SvgWriter { relative: false, shorthands: false, precision: config.path_precision };
        let (w, h) = (self.seg.width, self.seg.height);
        let mut out = Vec::new();
        if let Compositing::Mosaic { .. } = pipeline.compositing {
            if self.seg.layers.len() >= 1 << 24 { return Err(err("too many regions")); }
            let mut tagged = self.seg.clone();
            for (i, layer) in tagged.layers.iter_mut().enumerate() { layer.paint = index_paint(i); }
            for shape in pipeline.finish(&tagged).map_err(err)?.shapes {
                let i = paint_index(&shape.paint);
                let layer = self.seg.layers.get(i).ok_or_else(|| err("lost region provenance"))?;
                if let Some(d) = path_d(&writer, w, h, shape) {
                    out.push(TracedPath { region_id: i, color: hex(layer), d });
                }
            }
        } else {
            // Stacked: trace each layer alone so its path is tied to it.
            for (i, layer) in self.seg.layers.iter().enumerate() {
                let mut one = Segmentation::new(w, h);
                one.layers.push(layer.clone());
                if let Some(shape) = pipeline.finish(&one).map_err(err)?.shapes.into_iter().next() {
                    if let Some(d) = path_d(&writer, w, h, shape) {
                        out.push(TracedPath { region_id: i, color: hex(layer), d });
                    }
                }
            }
        }
        serde_wasm_bindgen::to_value(&out).map_err(err)
    }
}
