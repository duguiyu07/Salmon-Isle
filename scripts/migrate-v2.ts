import {beginDirectLibrary,libraryIdentity} from '../src/lib/direct-library';
import {withWorkspace,workspaceRoot} from '../src/lib/library-context';
import {validateLibrary} from '../src/lib/library-validation';
import {withRepositoryLock} from '../src/lib/repository-lock';
await withRepositoryLock(()=>{beginDirectLibrary();console.log(JSON.stringify({root:workspaceRoot(),...libraryIdentity(),...withWorkspace(()=>validateLibrary(workspaceRoot()))},null,2));});
