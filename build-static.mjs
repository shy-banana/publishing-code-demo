import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});await copyFile('static/index.html','dist/index.html');
