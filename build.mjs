// build.mjs
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const GITHUB_USER = 'ck10800766';
const GITHUB_REPO = 'mdbattle-visualizer';
const RAW_BUNDLE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/dist/mdbv.bundle.user.js`;

// build.mjs (Banner section)
const USERSCRIPT_BANNER = `// ==UserScript==
// @name         MDBattle-Visualizer (Ultimate Edition V7.4)
// @namespace    mydoujin-battle-vfx
// @version      7.4.0
// @description  True ATB Timeline, live battle interception, anti-spoiler guard, and refined combat mechanics.
// @match        https://mydoujin.online/*
// @run-at       document-start
// @grant        none
// @updateURL    ${RAW_BUNDLE_URL}
// @downloadURL  ${RAW_BUNDLE_URL}
// ==/UserScript==
`;

/**
 * Generates a single concatenated text file containing all raw src/*.js files
 * with their original import/export statements intact for AI code review.
 */
function generateAIContextFile() {
    const srcDir = './src';
    const outDir = './dist';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
    const sections = files.map(file => {
        const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
        return `// ==========================================\n// FILE: src/${file}\n// ==========================================\n${content.trim()}\n`;
    });

    fs.writeFileSync(path.join(outDir, 'ai-context.txt'), sections.join('\n'), 'utf8');
}

const isWatch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/mdbv.bundle.user.js',
    format: 'iife',
    banner: {
        js: USERSCRIPT_BANNER
    },
    sourcemap: isWatch ? 'inline' : false,
    plugins: [
        {
            name: 'ai-context-generator',
            setup(build) {
                build.onEnd(() => {
                    generateAIContextFile();
                });
            }
        }
    ]
};

if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching src/ for changes (and updating dist/ai-context.txt)...');
} else {
    await esbuild.build(buildOptions);
    console.log('Production build complete: dist/mdbv.bundle.user.js & dist/ai-context.txt');
}