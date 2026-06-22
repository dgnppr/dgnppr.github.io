#!/usr/bin/env node
'use strict';
const fs = require('fs');

main();

function cleanDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function main() {
    cleanDir('./data/metadata');
    cleanDir('./data/tags');
    console.log('[정리] data/metadata, data/tags 초기화 완료');

    const list = [];
    const tagMap = {};
    const pageMap = {};

    getFiles('./_wiki', 'wiki', list);
    getFiles('./_posts', 'blog', list);

    const dataList = list.map(file => collectData(file))
        .filter(row => row != null)
        .filter(row => row.public != 'false')
        .sort(lexicalOrderingBy('fileName'));

    dataList.forEach(data => {
        if (!data.tag) return;
        data.tag.forEach(tag => {
            if (!tagMap[tag]) tagMap[tag] = [];
            tagMap[tag].push({ fileName: data.fileName });
        });
    });

    for (const tag in tagMap) {
        tagMap[tag].sort(lexicalOrderingBy('fileName'));
    }

    dataList.sort(lexicalOrderingBy('fileName')).forEach(page => {
        pageMap[page.fileName] = {
            type: page.type,
            title: page.title,
            summary: page.summary,
            parent: page.parent,
            url: page.url,
            updated: page.updated || page.date,
            resource: page.resource,
            tags: page.tag || [],
            series: page.series || null,
            snippet: page.snippet || '',
            children: [],
        };
    });

    dataList.forEach(page => {
        if (!page.parent) return;
        const parent = pageMap[page.parent];
        if (parent && parent.children) parent.children.push(page.fileName);
    });

    saveTagFiles(tagMap, pageMap);
    saveTagCount(tagMap);
    saveMetaDataFiles(pageMap);
    saveDocumentUrlList(pageMap);
    saveSearchIndex(pageMap, tagMap);
    saveSeries(pageMap);
    saveHubData(pageMap);
}

function lexicalOrderingBy(property) {
    return (a, b) => a[property].toLowerCase().localeCompare(b[property].toLowerCase());
}

function saveTagFiles(tagMap, pageMap) {
    const seen = {};
    for (const tag in tagMap) {
        if (seen[tag.toLowerCase()]) {
            console.log('중복 태그가 있습니다.', tag);
            break;
        }
        seen[tag.toLowerCase()] = true;
        const collection = tagMap[tag].map(({ fileName }) => {
            const data = pageMap[fileName];
            return data.type === 'wiki' ? fileName : data.url;
        });
        fs.writeFileSync(`./data/tags/${tag}.json`, JSON.stringify(collection, null, 1));
    }
}

function saveMetaDataFiles(pageMap) {
    for (const page in pageMap) {
        const data = pageMap[page];
        const fileName = data.url.replace(/^\/wiki\//, '');
        const dirName = `./data/metadata/${fileName}`.replace(/\/[^/]*$/, '');
        fs.mkdirSync(dirName, { recursive: true });
        fs.writeFileSync(`./data/metadata/${fileName}.json`, JSON.stringify(data, null, 1));
    }
}

function saveDocumentUrlList(pageMap) {
    const urlList = Object.values(pageMap).map(d => d.url);
    fs.writeFileSync('./data/total-document-url-list.json', JSON.stringify(urlList, null, 1));
    console.log('The file "./data/total-document-url-list.json" has been saved.');
}

function saveSearchIndex(pageMap, tagMap) {
    const pageIndex = Object.values(pageMap).map(data => ({
        title: data.title || '',
        url: data.url,
        type: data.type,
        summary: data.summary || '',
        tags: data.tags || [],
        snippet: data.snippet || '',
    }));

    const tagIndex = Object.keys(tagMap).map(tag => ({
        title: tag,
        url: '/tags/#' + tag,
        type: 'tag',
        summary: '',
        tags: [],
    }));

    const index = [...pageIndex, ...tagIndex].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    fs.writeFileSync('./data/search-index.json', JSON.stringify(index));
    console.log('The file "./data/search-index.json" has been saved.');
}

function saveTagCount(tagMap) {
    const list = Object.keys(tagMap)
        .map(name => ({ name, size: tagMap[name].length }))
        .sort(lexicalOrderingBy('name'));
    fs.writeFileSync('./data/tag_count.json', JSON.stringify(list, null, 1));
    console.log('The file "./data/tag_count.json" has been saved.');
}

function saveSeries(pageMap) {
    const seriesMap = {};
    Object.entries(pageMap).forEach(([slug, page]) => {
        if (!page.series) return;
        if (!seriesMap[page.series]) seriesMap[page.series] = [];
        seriesMap[page.series].push({ slug, title: page.title, url: page.url, updated: page.updated || '' });
    });
    Object.values(seriesMap).forEach(entries => entries.sort((a, b) => a.updated.localeCompare(b.updated)));
    fs.writeFileSync('./data/series.json', JSON.stringify(seriesMap));
    console.log('The file "./data/series.json" has been saved.');
}

function saveHubData(pageMap) {
    const categories = {};
    Object.values(pageMap).forEach(page => {
        if (page.type !== 'wiki') return;
        const match = page.url.match(/^\/wiki\/([^/]+)\/[^/]+$/);
        if (!match) return;
        const cat = match[1];
        if (!categories[cat]) categories[cat] = { name: cat, docs: [] };
        categories[cat].docs.push({
            title: page.title,
            url: page.url,
            summary: page.summary || '',
            updated: page.updated || '',
            tags: page.tags || [],
        });
    });
    Object.values(categories).forEach(c => c.docs.sort((a, b) => b.updated.localeCompare(a.updated)));
    fs.writeFileSync('./data/hub.json', JSON.stringify(categories));
    console.log('The file "./data/hub.json" has been saved.');
}

function parseInfo(file, info) {
    if (info === null) return undefined;

    const obj = {
        fileName: file.path.replace(/^\.\/_wiki\/(.+)?\.md$/, '$1'),
        type: file.type,
        url: '',
        modified: fs.statSync(file.path).mtime,
    };

    info.split('\n').forEach(str => {
        const result = /^\s*([^:]+):\s*(.+)\s*$/.exec(str);
        if (!result) return;
        const key = result[1].trim();
        const val = result[2].trim().replace(/\[{2}\/?|\]{2}/g, '');
        obj[key] = val;
    });

    if (file.type === 'blog') {
        obj.url = '/blog/' + obj.date.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1/$2/$3/');
        obj.url += obj.fileName.replace(/^.*[/]\d{4}-\d{2}-\d{2}-([^/]*)\.md$/, '$1');
    } else if (file.type === 'wiki') {
        obj.url = file.path.replace(/^\.\/_wiki/, '/wiki').replace(/\.md$/, '');
    }

    if (obj.tag) obj.tag = obj.tag.split(/\s+/);
    return obj;
}

function getFiles(dir, type, array) {
    fs.readdirSync(dir).forEach(fileName => {
        const subPath = `${dir}/${fileName}`;
        if (fs.lstatSync(subPath).isDirectory()) {
            getFiles(subPath, type, array);
        } else if (/\.md$/.test(fileName)) {
            array.push({ path: subPath, type, name: fileName, children: [] });
        }
    });
}

function collectData(file) {
    const data = fs.readFileSync(file.path, 'utf8');
    const parts = data.split('---');
    const parsed = parseInfo(file, parts[1]);
    if (parsed && parts.length > 2) {
        parsed.snippet = parts.slice(2).join('---')
            .replace(/\*\s*TOC\s*\n\{:toc\}/g, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[#*_`\[\]>!]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400);
    }
    return parsed;
}
