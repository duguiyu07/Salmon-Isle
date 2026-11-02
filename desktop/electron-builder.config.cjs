const {build}=require('./package.json');
const repository=process.env.SALMON_RELEASE_REPOSITORY||require('../package.json').repository.url.replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'');
module.exports={...build,publish:[{provider:'generic',url:process.env.SALMON_DESKTOP_UPDATE_URL||'https://github.com/'+repository+'/releases/latest/download/'}]};
