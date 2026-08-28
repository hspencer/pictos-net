/** One source of document constraints; this explicit profile only tightens fresh output. */
export function generationProfile(documentSchema) {
  const schema = structuredClone(documentSchema);
  schema.$id = 'https://pictos.net/schemas/pictonet-nlu-generation-1.1.0.schema.json';
  schema.title = 'PictoNet NLU generation profile 1.1.0';
  schema.description = 'Strict profile for fresh Phase 1 output; historical imports use the document validator, not this profile.';
  schema.required = ['utterance', 'lang', 'metadata', 'frames', 'nsm_explications', 'logical_form', 'pragmatics', 'visual_guidelines'];
  delete schema.properties.NSM_explications;
  delete schema.properties.metadata.properties.timestamp;
  delete schema.properties.metadata.properties.speaker_id;
  schema.properties.nsm_explications.minProperties = 1;
  schema.$defs.LogicalForm.required = ['event', 'modality'];
  schema.$defs.Pragmatics.required = ['politeness', 'formality', 'expected_response'];
  schema.$defs.VisualGuidelines.required = ['focus_actor', 'action_core', 'object_core', 'context', 'temporal'];
  schema.properties.utterance.pattern = '\\S';
  for (const key of ['frame_name', 'lexical_unit']) schema.$defs.FrameObject.properties[key].pattern = '\\S';
  for (const key of ['ref', 'surface', 'lemma', 'ref_frame']) schema.$defs.RoleFiller.properties[key].pattern = '\\S';
  schema.$defs.LogicalForm.properties.event.pattern = '\\S';
  schema.properties.nsm_explications.additionalProperties.pattern = '\\S';
  return schema;
}
