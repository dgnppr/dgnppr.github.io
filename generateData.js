#!/usr/bin/env node

const YAML = require('yamljs');
const fs = require('fs');
const PRINT = true;
const NO_PRINT = false;

main();

function main() {
    const list = [];
    const tagMap = {};
    const pageMap = {};

    getFiles('./_wiki', 'wiki', list);
    getFiles('./_posts', 'blog', list);

    const dataList = list.map(file => collectData(file))
        .filter((row) => row != null)
        .filter((row) => row.public != 'false')
        .sort(lexicalOrderingBy('fileName'))


    dataList.forEach(function collectTagMap(data) {
        if (!data.tag) {
            return;
        }

        data.tag.forEach(tag => {
            if (!tagMap[tag]) {
                tagMap[tag] = [];
            }
            tagMap[tag].push({
                fileName: data.fileName,
                // updated: data.updated || data.date,
            });
        });
    });

    for (const tag in tagMap) {
        tagMap[tag].sort(lexicalOrderingBy('fileName'));
    }

    dataList.sort(lexicalOrderingBy('fileName'))
        .forEach((page) => {
            pageMap[page.fileName] =
                {
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
        if (page.parent) {

            const parent = pageMap[page.parent];

            if (parent && parent.children) {
                parent.children.push(page.fileName);
            }
        }
    });

    saveTagFiles(tagMap, pageMap);
    saveTagCount(tagMap);
    saveMetaDataFiles(pageMap);
    saveDocumentUrlList(pageMap);
    saveSearchIndex(pageMap, tagMap);
    saveRelatedPosts(pageMap);
    saveSeries(pageMap);
    saveHubData(pageMap);
}

function lexicalOrderingBy(property) {
    return (a, b) => a[property].toLowerCase()
        .localeCompare(b[property].toLowerCase())
}

/**
 * tag 하나의 정보 파일을 만든다.
 * 각 태그 하나는 하나의 json 파일을 갖게 된다.
 * 예를 들어 math 라는 태그가 있다면 ./data/tag/math.json 파일이 만들어진다.
 * json 파일의 내용은 fileName과 collection으로 구성된다.
 * 다음은 GNU.json 파일의 예이다.
 *
{
  "fileName": "agile",
  "collection": {
    "agile": {
      "type": "wiki",
      "title": "애자일(agile)에 대한 토막글 모음",
      "summary": "",
      "parent": "software-engineering",
      "url": "/wiki/agile",
      "updated": "2020-01-20 21:57:44 +0900",
      "children": []
    },
    "Tompson-s-rule-for-first-time-telescope-makers": {
      "type": "wiki",
      "title": "망원경 규칙 (Telescope Rule)",
      "summary": "4인치 반사경을 만든 다음에 6인치 반사경을 만드는 것이, 6인치 반사경 하나 만드는 것보다 더 빠르다",
      "parent": "proverb",
      "url": "/wiki/Tompson-s-rule-for-first-time-telescope-makers",
      "updated": "2019-11-24 09:36:53 +0900",
      "children": []
    }
  }
}
*/

function saveTagFiles(tagMap, pageMap) {
    fs.mkdirSync('./data/tags', { recursive: true }, (err) => {
        if (err) {
            return console.log(err);
        }
    })

    const completedTags = {};

    for (const tag in tagMap) {
        if (completedTags[tag.toLowerCase()]) {
            console.log("중복 태그가 있습니다.", tag);
            break;
        }
        completedTags[tag.toLowerCase()] = true;

        const collection = [];
        const tagDatas = tagMap[tag];

        for (const index in tagDatas) {
            const tagData = tagDatas[index];
            const data = pageMap[tagData.fileName]

            const documentId = (data.type === 'wiki')
                ? tagData.fileName
                : data.url;

            collection.push(documentId);
        }

        saveToFile(`./data/tags/${tag}.json`, JSON.stringify(collection, null, 1), NO_PRINT);
    }
}

/**
 * 파일 하나의 정보 파일을 만든다.
 * 각 파일 하나는 자신만의 정보를 갖는 json 파일을 갖게 된다.
 * 예를 들어 math.md 라는 파일이 있다면 ./data/metadata/math.json 파일이 만들어진다.
 * json 파일의 내용은 자신의 metadata와 자식 문서들의 목록이 된다.
 */
function saveMetaDataFiles(pageMap) {
    for (const page in pageMap) {
        const data = pageMap[page];
        const fileName = data.url.replace(/^[/]wiki[/]/, '');
        const dirName = `./data/metadata/${fileName}`
            .replace(/(\/\/)/g, '/')
            .replace(/[/][^/]*$/, '');

        fs.mkdirSync(dirName, { recursive: true }, (err) => {
            if (err) {
                return console.log(err);
            }
        })

        saveToFile(`./data/metadata/${fileName}.json`, JSON.stringify(data, null, 1), NO_PRINT);
    }
}

/**
 * 모든 문서 파일의 목록 json 파일을 생성합니다.
 */
function saveDocumentUrlList(pageMap) {
    const urlList = [];
    for (const page in pageMap) {
        const data = pageMap[page];
        urlList.push(data.url);
    }
    saveToFile("./data/total-document-url-list.json", JSON.stringify(urlList, null, 1), PRINT);
}

/**
 * 클라이언트 사이드 검색을 위한 인덱스 파일을 생성합니다.
 */
function saveSearchIndex(pageMap, tagMap) {
    const pageIndex = Object.values(pageMap).map(data => ({
        title: data.title || '',
        url: data.url,
        type: data.type,
        summary: data.summary || '',
        tags: data.tags || [],
        snippet: data.snippet || ''
    }));

    const tagIndex = Object.keys(tagMap).map(tag => ({
        title: tag,
        url: '/tags/#' + tag,
        type: 'tag',
        summary: '',
        tags: []
    }));

    const index = [...pageIndex, ...tagIndex]
        .sort((a, b) => a.title.localeCompare(b.title, 'ko'));

    saveToFile('./data/search-index.json', JSON.stringify(index), PRINT);
}

/**
 * 태그 하나가 갖는 자식 문서의 수를 파일로 저장한다.
 */
function saveTagCount(tagMap) {
    const list = [];
    for (const tag in tagMap) {
        list.push({
            name: tag,
            size: tagMap[tag].length
        });
    }
    const sortedList = list.sort((lexicalOrderingBy('name')));

    saveToFile("./data/tag_count.json", JSON.stringify(sortedList, null, 1), PRINT);
}

/**
 * 주어진 문자열을 파일로 저장합니다.
 *
 * @param fileLocation 파일 이름을 포함한 저장할 경로
 * @param dataString 파일의 내용이 될 문자열
 * @param isPrintWhenSuccess 파일이 저장되었을 때 표준 출력으로 메시지를 띄우려 한다면 true
 */
function saveToFile(fileLocation, dataString, isPrintWhenSuccess) {
    fs.writeFile(fileLocation, dataString, function(err) {
        if (err) {
            return console.log(err);
        }
        if (isPrintWhenSuccess) {
            console.log(`The file "${fileLocation}" has been saved.`);
        }
    });
}

function parseInfo(file, info) {
    if (info === null) {
        return undefined;
    }

    const obj = {
        fileName: file.path.replace(/^\.\/_wiki\/(.+)?\.md$/, '$1'),
        type: file.type,
        url: '',
        modified: fs.statSync(file.path).mtime
    };

    const rawData = info.split('\n');

    rawData.forEach(str => {
        const result = /^\s*([^:]+):\s*(.+)\s*$/.exec(str);

        if (result == null) {
            return;
        }

        const key = result[1].trim();
        const val = result[2].trim()
            .replace(/\[{2}\/?|\]{2}/g, '')    // 문서 이름 앞뒤의 [[  ]], [[/ ]] 를 제거한다.
        ;

        obj[key] = val;
    });

    if (file.type === 'blog') {
        obj.url = '/blog/' + obj.date.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1/$2/$3/');
        obj.url += obj.fileName.replace(/^.*[/]\d{4}-\d{2}-\d{2}-([^/]*)\.md$/, '$1');

    } else if (file.type === 'wiki') {
        obj.url = file.path
            .replace(/^\.\/_wiki/, '/wiki')
            .replace(/\.md$/, '');
    }

    if (obj.tag) {
        obj.tag = obj.tag.split(/\s+/);
    }
    return obj;
}

function isDirectory(path) {
    return fs.lstatSync(path).isDirectory();
}

function isMarkdown(fileName) {
    return /\.md$/.test(fileName);
}

function getFiles(path, type, array, testFileList = null) {

    fs.readdirSync(path).forEach(fileName => {

        const subPath = `${path}/${fileName}`;

        if (isDirectory(subPath)) {
            return getFiles(subPath, type, array, testFileList);
        }
        if (isMarkdown(fileName)) {
            if(testFileList && !testFileList.includes(fileName)) {
                return;
            }

            const obj = {
                'path': `${path}/${fileName}`,
                'type': type,
                'name': fileName,
                'children': [],
            };
            return array.push(obj);
        }
    });
}

function collectData(file) {
    const data = fs.readFileSync(file.path, 'utf8');
    const parts = data.split('---');
    const parsed = parseInfo(file, parts[1]);
    if (parsed && parts.length > 2) {
        const body = parts.slice(2).join('---')
            .replace(/\*\s*TOC\s*\n\{:toc\}/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[#*_`\[\]>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400);
        parsed.snippet = body;
    }
    return parsed;
}

function saveRelatedPosts(pageMap) {
    var entries = Object.entries(pageMap);
    var related = {};
    entries.forEach(function(entry) {
        var slug = entry[0];
        var page = entry[1];
        if (!page.tags || page.tags.length === 0) return;
        var scored = entries
            .filter(function(e) { return e[0] !== slug; })
            .map(function(e) {
                var s = e[0];
                var p = e[1];
                var overlap = (p.tags || []).filter(function(t) { return page.tags.includes(t); }).length;
                return { slug: s, score: overlap, title: p.title, url: p.url };
            })
            .filter(function(r) { return r.score > 0; })
            .sort(function(a, b) { return b.score - a.score; })
            .slice(0, 3)
            .map(function(r) { return { slug: r.slug, title: r.title, url: r.url }; });
        if (scored.length > 0) related[slug] = scored;
    });
    saveToFile('./data/related.json', JSON.stringify(related), PRINT);
}

function saveSeries(pageMap) {
    var seriesMap = {};
    Object.entries(pageMap).forEach(function(entry) {
        var slug = entry[0];
        var page = entry[1];
        if (!page.series) return;
        var name = page.series;
        if (!seriesMap[name]) seriesMap[name] = [];
        seriesMap[name].push({ slug: slug, title: page.title, url: page.url, updated: page.updated || '' });
    });
    Object.keys(seriesMap).forEach(function(name) {
        seriesMap[name].sort(function(a, b) { return a.updated.localeCompare(b.updated); });
    });
    saveToFile('./data/series.json', JSON.stringify(seriesMap), PRINT);
}

function saveHubData(pageMap) {
    var categories = {};
    Object.values(pageMap).forEach(function(page) {
        if (page.type !== 'wiki') return;
        var match = page.url.match(/^\/wiki\/([^/]+)\/[^/]+$/);
        if (!match) return;
        var cat = match[1];
        if (!categories[cat]) categories[cat] = { name: cat, docs: [] };
        categories[cat].docs.push({
            title: page.title,
            url: page.url,
            summary: page.summary || '',
            updated: page.updated || '',
            tags: page.tags || []
        });
    });
    Object.keys(categories).forEach(function(cat) {
        categories[cat].docs.sort(function(a, b) { return b.updated.localeCompare(a.updated); });
    });
    saveToFile('./data/hub.json', JSON.stringify(categories), PRINT);
}
