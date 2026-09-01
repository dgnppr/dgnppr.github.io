import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        emptyOutDir: false,
        outDir: 'js',
        lib: {
            entry: 'src/work/main.jsx',
            formats: ['iife'],
            name: 'PortfolioApp',
            fileName: () => 'work-app.js',
        },
        rollupOptions: {
            output: {
                assetFileNames: 'work-[name][extname]',
            },
        },
    },
});
