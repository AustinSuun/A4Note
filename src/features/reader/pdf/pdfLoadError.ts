/** Keep loading failures actionable without claiming that every error is a missing file. */
export function pdfLoadErrorMessage(error: unknown, stage: 'read' | 'parse' | 'pages'): string {
  const name = error instanceof Error ? error.name : '';
  const detail = (error instanceof Error ? error.message : String(error ?? '未知错误'))
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 700);
  let hint = stage === 'read'
    ? '无法读取 PDF 文件，请检查文献库文件是否存在以及当前用户的读取权限。'
    : stage === 'pages' ? 'PDF 已打开，但页面准备失败。' : '已读取文件，但 PDF 解析失败。';
  if (name === 'PasswordException') hint = '这份 PDF 需要密码；当前阅读器尚不支持密码输入，请先用可信 PDF 工具解锁后再导入。';
  else if (name === 'InvalidPDFException') hint = '文件不是有效 PDF 或内容已损坏，请确认原文件能否在其他 PDF 阅读器中打开。';
  else if (/worker|withResolvers|Promise\.try|toHex|fromHex|is not a function/i.test(detail)) {
    hint = 'PDF 渲染组件初始化或运行失败，请确认安装包完整，并更新 Microsoft Edge WebView2 Runtime。';
  }
  return `${hint}（阶段：${stage}；${name ? `${name}: ` : ''}${detail}）`;
}
