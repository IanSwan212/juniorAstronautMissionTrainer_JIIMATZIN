export function filaEscenario() {
  const record=(id,kind,data,role='environment')=>({record_id:String(id).repeat(64),record_type:kind,role,game_sol:1,game_phase:null,
    justification:'Selección explícita de prueba',dataset_id:'test_dataset',source_context:role==='environment'?'mars_historical_observation':'other_mission_educational',
    quality_status:kind==='observation'?'accepted':'not_applicable',quality_reasons:[],usage_tier:'runtime',
    data,processor_id:'a'.repeat(64),selection_policy_id:null,lineage_id:kind==='environment_hour'?String(id).repeat(64):null,
    source_refs:[{sourceFileId:`sha256:${'b'.repeat(64)}`,locator:{section:'body'}}]});
  const empty=(unit)=>({unit,count:0,source_count:0,rows_in_group:0,min:null,max:null,sample_mean:null,
    first_lmst:null,last_lmst:null,coverage_label:'empty',selection_fraction:null});
  return {code:'mars-demo',version:2,title:'Escenario de prueba',release_id:`rel_${'1'.repeat(32)}`,
    rules_version:'educational-1',rules:{mode:'educational'},language:'es',dataset_version:'1.0.0',dataset_schema_version:'1.0.0',
    model_assumptions:['Parámetros de prueba, sin fórmula física'],retrieved_at:null,
    conditions:[record(1,'observation',{variable:'ambient_temperature',value:207,unit:'K',source_sol:10,time_basis:'mars_lmst',lmst:'00010M00:00:00.000',
      ltst:'00010 00:35:00',sclk:398334263,flags_original:'111111111',flags_normalized:'111111111'}),
      record(2,'environment_hour',{source_sol:10,mission_day:1,lmst_hour:1,aggregation_rule:'hourly_lmst_sample_stats_v1',event_annotation_ids:[],temperature:empty('K'),pressure:empty('Pa')})],
    facts:[{fact_key:'fact_demo',record_id:'3'.repeat(64),language:'es',title:'Título',child_explanation:'Explicación',
      game_adaptation:'Adaptación',limitations:['Sin fórmula'],source_context:'other_mission_educational',game_sol:1,game_phase:'night'}],
  };
}
