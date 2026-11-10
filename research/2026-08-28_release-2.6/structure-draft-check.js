
import React from 'react';
import { createRoot } from 'react-dom/client';
import { assembleFromMapping } from '/services/svgStructureService.ts';
import { canStructureSVG, canCertifySVG, prepareSvgDraft, applySvgSafeUpdate, svgForEditing, prepareSvgEditorUpdate } from '/services/svgCanonical.ts';
import { assertValidSVG, inspectPassiveSVG, parseSVG } from '/schemas/mf-svg-schema/index.js';
import { SVGEditorModal } from '/components/SVGEditor/SVGEditorModal.tsx';
import '/styles/variables.css';
import '/styles/globals.css';
import '/styles/element-tree.css';
import { SVGGenerator } from '/components/SVGGenerator.tsx';
import { useTranslation } from '/hooks/useTranslation.ts';
const results=[];
const check=(name,condition)=>{if(!condition)throw Error(name);results.push('PASS '+name);document.querySelector('#checks').textContent=results.join('\n')};
try {
 const lib=await (await fetch('/libraries/escena_descriptiva_graph_2026-08-26.json')).json();
 const historical=lib.rows.find(r=>r.UTTERANCE==='Abro la app de delivery en mi teléfono');
 const rawSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="p0" d="M10 10L30 10L30 30Z" fill="#000000"/><path id="p1" d="M60 60L80 60L80 80Z" fill="#ffcc00"/></svg>';
 const row={...historical,rawSvg};
 const snapshot=JSON.stringify(row);
 const input={rawSvg,nlu:row.NLU,elements:row.elements,prompt:row.prompt,utterance:row.UTTERANCE,config:lib.config};
 const mapping={description:'Fixture local',groups:[{nodeId:'usuario',label:'Usuario',cssClass:'k',keep:['p0'],parentId:null}],discard:[]};
 check('Entrada histórica admitida para estructurar',canStructureSVG(row).eligible);
 check('No se falsea su certificación',!canCertifySVG(row).eligible);
 const result=assembleFromMapping(mapping,input);
 check('Ensamblado produce borrador visible: '+JSON.stringify(result.diagnostic),result.success&&!!result.draftSvg&&!result.svg);
 inspectPassiveSVG(result.draftSvg);
 const doc=parseSVG(result.draftSvg);
 check('Conserva ambos trazos, incluido el no asignado',doc.getElementsByTagName('path').length===2);
 const unclassified=Array.from(doc.getElementsByTagName('g')).find(g=>g.getAttribute('id')==='unclassified');
 check('El trazo no asignado no recibe un concepto inventado',!!unclassified&&!unclassified.hasAttribute('data-concept'));
 const evidence=JSON.parse(doc.getElementsByTagName('metadata')[0].textContent);
 check('NLU histórico intacto en el borrador',JSON.stringify(evidence.nlu)===JSON.stringify(row.NLU));
 check('Fila original intacta',JSON.stringify(row)===snapshot);
 const saved=applySvgSafeUpdate(row,prepareSvgDraft(row,result.draftSvg,result.diagnostic));
 check('Borrador guardado sin referencia canónica',!!saved.structuredSvgDraft&&!saved.svgReference);
 const completeMapping={...mapping,groups:[{...mapping.groups[0],keep:['p0','p1']}]};
 const oldNluOnly=assembleFromMapping(completeMapping,input);
 check('NLU incompatible por sí solo produce borrador, no bloqueo',oldNluOnly.success&&!!oldNluOnly.draftSvg&&oldNluOnly.diagnostic.key==='nluNeedsReview');
 const noNlu=assembleFromMapping(completeMapping,{...input,nlu:undefined});
 check('NLU ausente no se inventa ni impide el borrador',noNlu.success&&!!noNlu.draftSvg&&!JSON.parse(parseSVG(noNlu.draftSvg).getElementsByTagName('metadata')[0].textContent).nlu);
 const malformed=assembleFromMapping({groups:[]},input);
 check('Asignación vacía sigue rechazada',!malformed.success&&!malformed.draftSvg);
 const unsafe=assembleFromMapping(mapping,{...input,rawSvg:rawSvg.replace('<path','<script>alert(1)</script><path')});
 check('SVG activo sigue rechazado',!unsafe.success&&!unsafe.draftSvg);
 const example=await (await fetch('/schemas/mf-svg-schema/examples/v2example.svg')).text();
 const metadata=assertValidSVG(example);
 const validNlu=metadata.nlu;
 const composition=metadata.composition;
 const validInput={...input,nlu:validNlu,elements:composition.elements,prompt:composition.prompt,utterance:validNlu.utterance};
 const valid=assembleFromMapping({description:'Fixture completa',groups:[{nodeId:'persona',label:'Persona',cssClass:'k',keep:['p0'],parentId:null},{nodeId:'vaso',label:'Vaso',cssClass:'accent',keep:['p1'],parentId:null}],discard:[]},validInput);
 check('Entrada conforme sigue produciendo SVG canónico: '+String(valid.error),valid.success&&!!valid.svg&&!valid.draftSvg);
 assertValidSVG(valid.svg);
 function Demo(){
   const {lang,setLang}=useTranslation();
   const [current,setCurrent]=React.useState({...saved,structuredSvgDraftDiagnostic:{key:'structureFailed'}});
   const [editor,setEditor]=React.useState(null);
   const [message,setMessage]=React.useState('');
   return React.createElement(React.Fragment,null,
     React.createElement('button',{onClick:()=>setLang(lang==='es-419'?'en-GB':'es-419')},'Cambiar idioma de prueba'),
     React.createElement('p',{id:'editor-check-result'},message),
     React.createElement(SVGGenerator,{row:current,config:lib.config,layout:'stacked',onLog(){},onUpdate:update=>setCurrent(r=>applySvgSafeUpdate(r,update)),onOpenEditor:source=>setEditor(svgForEditing(current,source)),onOpenVectorizer(){}}),
     editor&&React.createElement(SVGEditorModal,{isOpen:true,initialSvg:editor.svg,svgSource:editor.source,utterance:row.UTTERANCE,styleDefs:lib.config.svgStyleDefs||[],onClose:()=>setEditor(null),onSave:async svg=>{
       const update=await prepareSvgEditorUpdate(current,editor.source,svg);
       const next=applySvgSafeUpdate(current,update);
       check('Editor abre y guarda el borrador separado del trazado',editor.source==='draft'&&next.rawSvg===row.rawSvg&&next.structuredSvg===current.structuredSvg&&!next.svgReference);
       check('Guarda los cambios del borrador sin certificar',next.structuredSvgDraft===svg&&next.structuredSvgDraftDiagnostic.key==='draftEdited');
       setCurrent(next);setEditor(null);setMessage('PASS: borrador guardado; trazado conservado; sin certificación automática.');
     }}));
 }
 createRoot(document.querySelector('#ui')).render(React.createElement(Demo));
 results.push('FINAL: todas las comprobaciones pasaron. No se llamó a ningún proveedor.');
 document.querySelector('#checks').textContent=results.join('\n');
} catch(e){document.querySelector('#checks').textContent=results.join('\n')+'\nFAIL '+e.message;console.error(e);}
