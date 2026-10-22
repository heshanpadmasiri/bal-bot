export const testScope = {id:'service', kind:'service', title:'/', source:{file:'main.bal',range:{start:{line:1,column:1},end:{line:1,column:1}}}};
export const testAgentScope = {id:'service', kind:'service', title:'/', source:testScope.source};
// Transport/agent tests use a stable discovered anchor; real discovery is tested through WASM.
export async function analyze() { return {kind:'valid', diagnostics:[],program:{scopes:[{...testScope,text:'',moduleId:'browser/http_service',serviceType:'http',endpoints:[],definitions:[]}],functions:{}}}; }
