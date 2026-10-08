import { ProjectStore } from '../src/storage.ts';
import { createImageAsset, createProject, parseProjectJson, serializeProject } from '../src/model.ts';
const api = { ProjectStore, createImageAsset, createProject, parseProjectJson, serializeProject };
declare global { interface Window { colorStorage: typeof api } }
window.colorStorage = api;
