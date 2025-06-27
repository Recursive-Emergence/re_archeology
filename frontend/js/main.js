// Entry point for RE-Archaeology App
import { REArchaeologyApp } from './app-core.js';

window.addEventListener('DOMContentLoaded', () => {
    window.reArchaeologyApp = new REArchaeologyApp();
    window.reArchaeologyApp.init();
});
