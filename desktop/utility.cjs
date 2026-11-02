const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=__dirname.replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked');
process.chdir(path.join(root,'web'));
import(pathToFileURL(path.join(root,'web','server.js')).href).catch(error=>{console.error(error);process.exit(1);});
