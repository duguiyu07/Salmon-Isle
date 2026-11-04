export async function register(){
  if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'){
    const {withWorkspace}=await import('./lib/library-context');
    const {recoverLibraryTransaction}=await import('./lib/library-transaction');withWorkspace(()=>recoverLibraryTransaction());
    const {beginDirectLibrary}=await import('./lib/direct-library');beginDirectLibrary();
  }
}
