export async function contentApi<T=any>(url:string,data?:unknown,method='POST'):Promise<T>{
  const response=await fetch('/api/'+url,data===undefined?{cache:'no-store'}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'操作失败'),{status:response.status});return result;
}
