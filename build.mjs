// ==========================================
// FILE: build.mjs
// ==========================================
/**
 * @fileoverview esbuild bundler and AI context generator for MDBattle-Visualizer.
 * Bundles `src/index.js` into an IIFE Userscript (`dist/mdbv.bundle.user.js`) with
 * Tampermonkey/Violentmonkey metadata headers, and generates `dist/ai-context.txt`
 * containing concatenated raw source modules for AI code review.
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const VERSION = pkg.version || '7.4.0';
const MAJOR_MINOR = VERSION.split('.').slice(0, 2).join('.');

const GITHUB_USER = 'ck10800766';
const GITHUB_REPO = 'mdbattle-visualizer';
const RAW_BUNDLE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/dist/mdbv.bundle.user.js`;

const USERSCRIPT_BANNER = `// ==UserScript==
// @name         MDBattle-Visualizer (Ultimate Edition V${MAJOR_MINOR})
// @namespace    mydoujin-battle-vfx
// @version      ${VERSION}
// @description  True ATB Timeline, live battle interception, anti-spoiler guard, and refined combat mechanics.
// @match        https://mydoujin.online/*
// @run-at       document-start
// @grant        none
// @updateURL    ${RAW_BUNDLE_URL}
// @downloadURL  ${RAW_BUNDLE_URL}
// ==/UserScript==
`;

/**
 * Generates a single concatenated text file (`dist/ai-context.txt`) containing
 * all raw `src/*.js` files with their original import/export statements intact
 * for convenient AI code review and debugging.
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
let startTime = 0;

const buildReporterPlugin = {
    name: 'build-reporter-plugin',
    setup(build) {
        build.onStart(() => {
            startTime = Date.now();
        });
        build.onEnd(result => {
            const elapsed = Date.now() - startTime;
            const now = new Date().toLocaleTimeString();
            if (result.errors && result.errors.length > 0) {
                console.error(`[${now}] Build failed with ${result.errors.length} error(s):`);
                result.errors.forEach(err => console.error(err));
                return;
            }
            try {
                generateAIContextFile();
            } catch (err) {
                console.warn(`[${now}] Warning: Failed to update ai-context.txt:`, err.message);
            }
            if (isWatch) {
                console.log(`[${now}] Rebuild complete in ${elapsed}ms -> dist/mdbv.bundle.user.js (v${VERSION})`);
            }
        });
    }
};

const buildOptions = {
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/mdbv.bundle.user.js',
    format: 'iife',
    banner: {
        js: USERSCRIPT_BANNER
    },
    sourcemap: isWatch ? 'inline' : false,
    plugins: [buildReporterPlugin]
};

if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] Watching src/ for changes... (Press Ctrl+C to stop)`);
} else {
    await esbuild.build(buildOptions);
    console.log(`Production build complete (v${VERSION}): dist/mdbv.bundle.user.js & dist/ai-context.txt`);
}