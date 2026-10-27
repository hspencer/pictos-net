#!/usr/bin/env python3
"""
actualizar-imagenes.py

Reemplaza las capturas incrustadas en un tutorial .docx por las versiones
actuales de una carpeta de imágenes, sin tocar el texto ni el formato que se
haya editado en Word.

Cada imagen del documento lleva como nombre (propiedad «name» de Word) el
nombre de su archivo, por ejemplo «11-secuencia-lista.png». El script busca
en la carpeta un archivo con ese mismo nombre y, si existe, lo pone en lugar
de la imagen incrustada. Conserva el ancho con que la imagen aparece en la
página y ajusta el alto a la proporción de la captura nueva, para que nada
se deforme si la recortaste o reencuadraste.

Uso (desde la carpeta public/tutorial):
    python3 ../../scripts/tutorial/actualizar-imagenes.py tutorial-pictos-2.0-es.docx img
    python3 ../../scripts/tutorial/actualizar-imagenes.py pictos-tutorial-2.0-en.docx img-en

El documento se sobrescribe en su lugar, sin dejar copias.
Solo usa la biblioteca estándar de Python.
"""
import os
import re
import struct
import sys
import zipfile

NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def png_size(data):
    """Devuelve (ancho, alto) de un PNG leyendo su encabezado.
    La usa main() para recalcular la proporción de cada imagen nueva."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', data[16:24])


def drawings(xml):
    """Recorre cada <w:drawing> del documento y entrega (inicio, fin, texto).
    La usa main() para encontrar el nombre y la relación de cada imagen."""
    for m in re.finditer(r'<w:drawing>.*?</w:drawing>', xml, re.S):
        yield m.start(), m.end(), m.group(0)


def main(docx, imgdir):
    """Abre el .docx, cambia las imágenes que tengan reemplazo y lo guarda.
    Es el punto de entrada del script."""
    with zipfile.ZipFile(docx) as z:
        files = {n: z.read(n) for n in z.namelist()}
    xml = files['word/document.xml'].decode('utf-8')
    rels = files['word/_rels/document.xml.rels'].decode('utf-8')
    rel_target = dict(re.findall(r'Id="([^"]+)"[^>]*?Target="([^"]+)"', rels))

    changed, missing, out, last = [], [], [], 0
    for start, end, d in drawings(xml):
        name = re.search(r'<wp:docPr [^>]*name="([^"]+)"', d)
        embed = re.search(r'r:embed="([^"]+)"', d)
        if not name or not embed:
            continue
        name, rid = name.group(1), embed.group(1)
        src = os.path.join(imgdir, name)
        if not os.path.isfile(src):
            missing.append(name)
            continue
        new = open(src, 'rb').read()
        target = 'word/' + rel_target[rid].lstrip('/').replace('word/', '', 1)
        if files.get(target) == new:
            continue
        size = png_size(new)
        files[target] = new
        if size:
            # Mantener el ancho mostrado y ajustar el alto a la nueva proporción.
            w, h = size
            cx = int(re.search(r'<wp:extent cx="(\d+)"', d).group(1))
            cy = round(cx * h / w)
            d = re.sub(r'(<wp:extent cx="\d+" cy=")\d+(")', rf'\g<1>{cy}\g<2>', d)
            d = re.sub(r'(<a:ext cx="\d+" cy=")\d+(")', rf'\g<1>{cy}\g<2>', d)
        out.append(xml[last:start]); out.append(d); last = end
        changed.append(name)
    out.append(xml[last:])
    files['word/document.xml'] = ''.join(out).encode('utf-8')

    if changed:
        tmp = docx + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for n, data in files.items():
                z.writestr(n, data)
        os.replace(tmp, docx)
    print(f'Imágenes actualizadas: {len(changed)}')
    for n in changed:
        print('  ' + n)
    if missing:
        print(f'Sin archivo en {imgdir} (se dejaron como estaban): ' + ', '.join(sorted(set(missing))))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
