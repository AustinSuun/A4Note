import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Exercise the real renderer, not a duplicated parser or a source-string mock.
const source=fs.readFileSync('src/shared/markdown/MarkdownCallout.tsx','utf8');
const output=path.resolve('.tmp/callout-reading-regression',String(process.pid));
fs.mkdirSync(output,{recursive:true});
try {
  const moduleFile=path.join(output,'MarkdownCallout.mjs');
  fs.writeFileSync(moduleFile,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
  const {MarkdownCallout}=await import(pathToFileURL(moduleFile).href);
  const render=markdown=>renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkGfm],components:{blockquote:MarkdownCallout},children:markdown}));
  const body=html=>html.match(/class="markdown-callout-content">([\s\S]*?)<\/div>/)?.[1]??'';
  let assertions=0;
  const check=(value,message)=>{assert.ok(value,message);assertions++};
  let html=render('> [!NOTE]\n> 正文保留');
  check(body(html).includes('正文保留'),'Untitled marker must retain first body line');
  check(!html.includes('<strong>笔记</strong>'),'Do not duplicate localized label as a fallback title');
  html=render('> [!NOTE] **格式标题**\n> 正文 **强调** 与 `代码`');
  check(html.includes('<strong>格式标题</strong>'),'Header has flattened explicit title');
  check(!body(html).includes('格式标题'),'Formatted title is removed from body exactly once');
  check(body(html).includes('<strong>强调</strong>'),'Body inline formatting survives header removal');
  check(body(html).includes('<code>代码</code>'),'Body code survives header removal');
  html=render('> [!CUSTOM]\n> 未知类型正文');
  check(html.includes('markdown-callout-custom'),'Unknown types still render');
  check(body(html).includes('未知类型正文'),'Unknown untitled body survives');
  check(!html.includes('markdown-callout-label'),'Unknown label is not duplicated');
  html=render('> [!TIP]');
  check(html.includes('markdown-callout-tip'),'Header-only callout renders');
  check(body(html).trim()==='','Header-only body remains empty');
  html=render('> 普通引用');
  check(!html.includes('markdown-callout'),'Ordinary quote is not a callout');
  html=render('> [!NOTE] 标题\n> 第一段\n>\n> 第二段');
  check(body(html).includes('第一段')&&body(html).includes('第二段'),'Multiple paragraphs are retained');
  html=render('> [!NOTE]\n>\n> 后续正文');
  check(body(html).includes('后续正文'),'A separator after an untitled header retains following blocks');
  console.log(`Callout reading regression passed (${assertions} assertions)`);
} finally {fs.rmSync(output,{recursive:true,force:true});}
