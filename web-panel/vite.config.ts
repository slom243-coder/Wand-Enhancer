import { fileURLToPath, URL } from 'node:url';
import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
        lingui(),
        tailwindcss(),
    ],
    base: './',
    resolve: {
        alias: [
            { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
            { find: 'react-dom/client', replacement: 'preact/compat/client' },
            { find: 'react-dom', replacement: 'preact/compat' },
            { find: 'react/jsx-runtime', replacement: 'preact/jsx-runtime' },
            { find: 'react/jsx-dev-runtime', replacement: 'preact/jsx-dev-runtime' },
            { find: 'react', replacement: 'preact/compat' },
        ],
    },
    server: {
        host: '127.0.0.1',
        port: 4173,
        strictPort: true,
    },
    preview: {
        host: '127.0.0.1',
        port: 4173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                toolbox: fileURLToPath(new URL('./toolbox.html', import.meta.url)),
            },
        },
        assetsDir: 'assets',
        target: 'es2020',
        sourcemap: false,
    },
});
