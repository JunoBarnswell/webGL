import { defineConfig } from 'vite';
export default defineConfig({base:'/player/',publicDir:false,server:{port:5174,proxy:{'/api':'http://127.0.0.1:18080'}},build:{sourcemap:true}});
