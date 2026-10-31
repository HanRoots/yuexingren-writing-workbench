import React, { useEffect, useRef, useState } from 'react';
import { FileText, BookOpen, Settings, Folder, Plus, Upload, Sparkles, Info, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Trash2, Check, Download, Image as ImageIcon, Copy, PencilLine, LoaderCircle, ZoomIn, ShieldCheck, Menu, ArrowRight } from 'lucide-react';
import { createStudent, updateStudent, confirmBody, confirmQuote, canExport, exportBlockingReasons, isQuoteExact } from './domain.js';
import { recognizeWriting } from './ai.js';
import { renderStudent, textDownload } from './export.js';
import { loadWorkspace, saveWorkspace, clearWorkspace } from './storage.js';
import { readImageFile } from './media.js';

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
const DEFAULT_SETTINGS = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' };
function initialSettings() {
  try { const s = JSON.parse(localStorage.getItem('yxr-api-preferences')); return { ...DEFAULT_SETTINGS, ...s, apiKey: '' }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function Button({ children, icon: Icon, primary, className = '', ...props }) {
  return <button className={`button ${primary ? 'primary' : ''} ${className}`} {...props}>{Icon && <Icon size={18} aria-hidden="true" />}{children}</button>;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide-modal' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className="modal-top"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X /></button></div>{children}
  </dialog>;
}
function Field({ label, children, optional = false }) { return <label className="field"><span>{label}{optional && <small>选填</small>}</span>{children}</label>; }

export default function App() {
  const [students, setStudents] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [step, setStep] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [saveStatus, setSaveStatus] = useState('本机工作区');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [replaceRequest, setReplaceRequest] = useState(false);
  const fileInput = useRef();
  const abortRef = useRef();
  const canvasRef = useRef(null);
  const versionRef = useRef(0);
  const student = students.find(s => s.id === activeId) || students[0];

  useEffect(() => {
    let live = true;
    loadWorkspace().then(saved => {
      if (!live) return;
      const records = Array.isArray(saved) && saved.length ? saved.map(s => createStudent(s)) : [createStudent()];
      // Confirmation requires a new review when a saved draft is reopened.
      setStudents(records); setActiveId(records[0].id); setStorageReady(true); setHydrated(true);
    }).catch(e => { if (live) { const s = createStudent(); setStudents([s]); setActiveId(s.id); setHydrated(true); setSaveStatus('草稿读取失败'); setNotice({ error: true, text: `${e.message} 为保护已有草稿，自动保存已暂停；刷新页面可重试读取。` }); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!hydrated || !storageReady) return;
    setSaveStatus('正在保存草稿');
    const t = setTimeout(() => saveWorkspace(students).then(() => setSaveStatus('草稿已存本机')).catch(e => { setSaveStatus('草稿未保存'); setNotice({ error: true, text: e.message }); }), 500);
    return () => clearTimeout(t);
  }, [students, hydrated, storageReady]);
  useEffect(() => { setPageIndex(0); setPreview(null); canvasRef.current = null; }, [activeId]);
  useEffect(() => { if (!notice || notice.error) return; const t = setTimeout(() => setNotice(null), 4200); return () => clearTimeout(t); }, [notice]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); if (preview?.jpgUrl) URL.revokeObjectURL(preview.jpgUrl); }, [preview]);

  function tell(text, error = false) { setNotice({ text, error }); }
  function apply(patch) {
    versionRef.current += 1;
    setStudents(all => all.map(s => s.id === student.id ? updateStudent(s, patch) : s));
    setPreview(null); canvasRef.current = null;
  }
  function chooseStudent(id) { if (busy) return; setActiveId(id); setStep(1); }
  function addStudent() { const s = createStudent(); setStudents(all => [...all, s]); setActiveId(s.id); setStep(1); }
  async function upload(files) {
    const list = Array.from(files || []); if (!list.length || busy) return;
    if (student.pages.length + list.length > 20) return tell('每位同学最多整理 20 页，请分次处理。', true);
    setBusy('upload');
    try { const pages = []; for (const f of list) pages.push(await readImageFile(f)); apply({ pages: [...student.pages, ...pages] }); tell(`已添加 ${pages.length} 页，请检查同学归属和页序。`); }
    catch (e) { tell(e.message, true); }
    finally { setBusy(''); if (fileInput.current) fileInput.current.value = ''; }
  }
  function reorder(index, delta) { const pages = [...student.pages]; const target = index + delta; if (target < 0 || target >= pages.length) return; [pages[index], pages[target]] = [pages[target], pages[index]]; apply({ pages }); setPageIndex(target); }
  function movePage(pageId, targetId) {
    const page = student.pages.find(p => p.id === pageId); if (!page) return;
    const target = students.find(s => s.id === targetId);
    if (target.pages.length >= 20) return tell('目标同学已有 20 页，请分次处理。', true);
    setStudents(all => all.map(s => s.id === student.id ? updateStudent(s, { pages: s.pages.filter(p => p.id !== pageId) }) : s.id === targetId ? updateStudent(s, { pages: [...s.pages, page] }) : s));
    setPreview(null); canvasRef.current = null; setPageIndex(0); tell('原稿已移至另一位同学，请重新核对文字。');
  }
  async function recognize() {
    if (!settings.apiKey || !settings.model) { setModal('settings'); tell('先填写 API 密钥和支持图片的模型，再开始识别。'); return; }
    if (student.body.trim() && !replaceRequest) { setModal('replace'); return; }
    setReplaceRequest(false); setModal(null); setBusy('recognize'); setNotice(null);
    const controller = new AbortController(); abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const result = await recognizeWriting({ pages: student.pages, settings, signal: controller.signal });
      apply({ ...result, name: result.name || student.name, title: result.title || student.title, date: result.date || student.date, includeQuote: Boolean(result.quote) });
      setStep(2); tell('识别完成。请逐句对照原稿核对，AI 结果仍可能有误。');
    } catch (e) { tell(e.message, true); }
    finally { clearTimeout(timeout); abortRef.current = null; setBusy(''); }
  }
  function confirm(kind) {
    try { const updated = kind === 'body' ? confirmBody(student) : confirmQuote(student); setStudents(all => all.map(s => s.id === student.id ? updated : s)); tell(kind === 'body' ? '当前正文已确认。' : '当前摘录已确认。'); }
    catch (e) { tell(e.message, true); }
  }
  async function generate() {
    const version = versionRef.current;
    setBusy('render');
    try { const canvas = await renderStudent(student); const encode = (type) => new Promise((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('生成图片失败，请减少原稿页数后重试。')), type, 0.95)); const [png, jpg] = await Promise.all([encode('image/png'), encode('image/jpeg')]); if (version !== versionRef.current) { tell('内容已变更，请重新确认后再生成图片。'); return; } canvasRef.current = canvas; setPreview({ url: URL.createObjectURL(png), jpgUrl: URL.createObjectURL(jpg), stem: `${student.name ? student.name + '-' : ''}${student.title}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100), width: canvas.width, height: canvas.height }); tell('长图已生成，可以下载 JPG 或 PNG。'); }
    catch (e) { tell(e.message, true); }
    finally { setBusy(''); }
  }
  function saveSettings(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = { provider: form.get('provider'), baseUrl: form.get('baseUrl').trim(), model: form.get('model').trim(), apiKey: form.get('apiKey').trim() };
    try { const url = new URL(next.baseUrl); if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || url.username || url.password || url.search || url.hash) throw Error(); }
    catch { return tell('请填写不带密钥和参数的 HTTPS API 地址；本机 localhost 可用 HTTP。', true); }
    setSettings(next); setModal(null);
    try { localStorage.setItem('yxr-api-preferences', JSON.stringify({ ...next, apiKey: undefined })); tell('API 设置已更新，密钥只在当前页面内存中使用。'); }
    catch { tell('设置在当前页面生效；浏览器未允许保存接口偏好，刷新后需重新填写。'); }
  }
  async function clearAll() {
    try { await clearWorkspace(); const s = createStudent(); setStorageReady(true); setStudents([s]); setActiveId(s.id); setPreview(null); setStep(1); setModal(null); tell('已清空本机习作草稿。'); }
    catch (e) { tell(e.message, true); }
  }

  if (!hydrated || !student) return <div className="loading"><LoaderCircle className="spin" />正在打开本机工作区…</div>;
  const currentPage = student.pages[Math.min(pageIndex, student.pages.length - 1)];
  const reasons = exportBlockingReasons(student);
  const ready = canExport(student);
  return <>
    <aside className="sidebar">
      <div className="brand"><img src={`${ASSETS}logo-mark.png`} alt="" /><strong>阅星人读书社</strong></div>
      <nav aria-label="主导航"><button className="nav-item active" onClick={() => setStep(1)}><FileText />学生习作</button><button className="nav-item" onClick={() => setModal('help')}><BookOpen />使用说明</button></nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setModal('settings')}><Settings />API 设置</button><div className="workspace-status"><Folder size={20} /><span>{saveStatus}</span></div></div>
    </aside>
    <div className="mobile-header"><div className="mobile-brand"><img src={`${ASSETS}logo-mark.png`} alt="" /><strong>阅星人读书社</strong></div><button className="icon-button" onClick={() => setModal('settings')} aria-label="API 设置"><Settings /></button></div>
    <main>
      <header className="topbar"><div className="breadcrumb">内容工具 <span>/</span> 学生习作</div><Button icon={Settings} onClick={() => setModal('settings')}>API 设置{settings.apiKey && <span className="configured-dot" aria-label="密钥已填写" />}</Button></header>
      <div className="page-heading"><h1>学生习作工作台</h1><p>从手写原稿到家长分享长图。</p></div>
      <nav className="steps" aria-label="整理步骤">{['上传原稿', '识别与核对', '确认与下载'].map((label, i) => <React.Fragment key={label}><button aria-current={step === i + 1 ? 'step' : undefined} className={`step ${step === i + 1 ? 'current' : ''} ${step > i + 1 ? 'passed' : ''}`} disabled={Boolean(busy)} onClick={() => setStep(i + 1)}><span className="step-number">{String(i + 1).padStart(2, '0')}</span><span>{label}</span></button>{i < 2 && <div className={`step-line ${step > i + 1 ? 'passed' : ''}`} />}</React.Fragment>)}</nav>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><Info size={18} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      <div className="workbench">
        <section className="student-panel" aria-label="本次习作">
          <div className="panel-heading"><h2>本次习作</h2><Button icon={Plus} disabled={Boolean(busy)} onClick={addStudent}>新增</Button></div>
          <div className="student-list">{students.map((s, i) => <button className={`student-row ${s.id === student.id ? 'selected' : ''}`} key={s.id} disabled={Boolean(busy)} onClick={() => chooseStudent(s.id)}><FileText size={25} /><span><strong>{s.name || '未命名同学'}{!s.name && students.length > 1 ? ` ${i + 1}` : ''}</strong><small>{s.pages.length} 张原稿{canExport(s) ? ' · 已确认' : s.body ? ' · 待核对' : ''}</small></span></button>)}</div>
          <div className="student-panel-bottom"><Info size={18} /><span>不同同学请分别上传。</span></div>
        </section>
        <section className={`editor-panel step-${step}`} aria-label={['上传原稿', '识别与核对', '确认与下载'][step - 1]}>
          {step === 1 && <>
            <div className="panel-heading upload-heading"><h2>上传手写原稿</h2><span className="quiet-tag">支持多页</span>{student.pages.length > 0 && <button className="text-button push-right" onClick={() => fileInput.current.click()} disabled={Boolean(busy)}>继续添加</button>}</div>
            <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={e => upload(e.target.files)} disabled={Boolean(busy)} aria-label="选择手写原稿照片" />
            {student.pages.length === 0 ? <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}>
              <Upload className="upload-symbol" strokeWidth={1.7} /><h3>拖拽照片到这里，或点击上传</h3><p>支持 JPG、PNG、WebP，可多选。</p><Button primary onClick={() => fileInput.current.click()} disabled={Boolean(busy)}>{busy === 'upload' ? '正在读取…' : '选择照片'}</Button>
            </div> : <div className="page-list">{student.pages.map((p, i) => <div className="page-row" key={p.id}>
              <button className="thumbnail" onClick={() => { setPageIndex(i); setModal('original'); }} aria-label={`放大第 ${i + 1} 页`}><img src={p.dataUrl} alt={`手写原稿第 ${i + 1} 页`} /></button>
              <div className="page-info"><strong>第 {i + 1} 页</strong><span title={p.name}>{p.name}</span>{students.length > 1 && <select aria-label={`将第${i + 1}页移至同学`} value="" disabled={Boolean(busy)} onChange={e => { if (e.target.value) movePage(p.id, e.target.value); }}><option value="">移至其他同学…</option>{students.filter(s => s.id !== student.id).map((s, n) => <option key={s.id} value={s.id}>{s.name || `其他同学 ${n + 1}`}</option>)}</select>}</div>
              <div className="page-actions"><button className="icon-button" aria-label={`上移第${i + 1}页`} disabled={i === 0 || Boolean(busy)} onClick={() => reorder(i, -1)}><ArrowUp size={18} /></button><button className="icon-button" aria-label={`下移第${i + 1}页`} disabled={i === student.pages.length - 1 || Boolean(busy)} onClick={() => reorder(i, 1)}><ArrowDown size={18} /></button><button className="icon-button danger" aria-label={`删除第${i + 1}页`} disabled={Boolean(busy)} onClick={() => { apply({ pages: student.pages.filter(q => q.id !== p.id) }); setPageIndex(0); }}><Trash2 size={18} /></button></div>
            </div>)}</div>}
            <div className="upload-summary"><span><FileText size={19} />{student.pages.length ? `已添加 ${student.pages.length} 页原稿` : '尚未上传原稿'}</span><Button icon={FileText} disabled={Boolean(busy)} onClick={() => setStep(2)}>粘贴已有文字</Button></div>
            <div className="panel-footer"><p><Info size={18} />请先按同学分组，再检查原稿顺序。</p>{busy === 'recognize' ? <Button onClick={() => abortRef.current?.abort()}>取消识别</Button> : <Button primary={student.pages.length > 0} icon={busy ? LoaderCircle : Sparkles} disabled={!student.pages.length || Boolean(busy)} onClick={recognize}> {busy === 'upload' ? '读取照片中…' : 'AI 识别原稿'}</Button>}</div>
            {busy === 'recognize' && <p className="processing"><LoaderCircle size={17} className="spin" />正在读取这位同学的全部原稿，请稍候…</p>}
          </>}
          {step === 2 && <>
            <div className="panel-heading"><h2>识别与核对</h2><span className="quiet-tag">最小校订稿</span><button className="text-button push-right" onClick={() => setStep(1)}>管理原稿</button></div>
            <div className="review-layout">
              <div className="original-pane"><div className="original-toolbar"><strong>手写原稿</strong><div><button className="icon-button" aria-label="上一页原稿" disabled={!currentPage || pageIndex === 0} onClick={() => setPageIndex(i => i - 1)}><ChevronLeft size={18} /></button><span>{currentPage ? `${Math.min(pageIndex + 1, student.pages.length)} / ${student.pages.length}` : '0 / 0'}</span><button className="icon-button" aria-label="下一页原稿" disabled={!currentPage || pageIndex >= student.pages.length - 1} onClick={() => setPageIndex(i => i + 1)}><ChevronRight size={18} /></button></div></div>{currentPage ? <button className="original-image" onClick={() => setModal('original')} aria-label="放大查看手写原稿"><img src={currentPage.dataUrl} alt={`原稿第 ${pageIndex + 1} 页`} /><span><ZoomIn size={16} />放大查看</span></button> : <div className="original-empty"><FileText /><p>尚未上传手写原稿</p><button className="text-button" onClick={() => setStep(1)}>返回上传</button></div>}</div>
              <div className="text-pane"><div className="metadata-fields"><Field label="原稿题目"><input value={student.title} onChange={e => apply({ title: e.target.value })} placeholder="填写原稿题目" /></Field><Field label="同学姓名" optional><input value={student.name} onChange={e => apply({ name: e.target.value })} placeholder="按原稿填写" /></Field><Field label="日期" optional><input value={student.date} onChange={e => apply({ date: e.target.value })} placeholder="按原稿填写" /></Field></div><Field label="文字整理稿"><textarea className="body-editor" value={student.body} onChange={e => apply({ body: e.target.value })} placeholder="AI 识别结果会显示在这里，也可以粘贴已有文字。请保留孩子原意，仅修改明确错字、标点和局部不通顺处。" /></Field><p className="field-note">请逐句对照原稿。题目和正文不可留空，缺失的姓名、日期无需补写。</p></div>
            </div>
            {student.uncertainties.length > 0 && <div className="uncertainties"><h3><Info size={18} />待核对问题</h3>{student.uncertainties.map((item, i) => <div className="uncertainty-row" key={`${i}-${item}`}><span>{item}</span><button className="text-button" onClick={() => apply({ uncertainties: student.uncertainties.filter((_, n) => n !== i) })}>已核实</button></div>)}<p>核实后请同步修正正文中的【待确认】标记。</p></div>}
            <div className="panel-footer"><Button icon={Download} disabled={!student.body.trim()} onClick={() => textDownload(student)}>下载文字</Button><Button primary icon={ArrowRight} disabled={!student.body.trim()} onClick={() => setStep(3)}>核对正文与摘录</Button></div>
          </>}
          {step === 3 && <>
            <div className="panel-heading"><h2>确认与下载</h2><button className="text-button push-right" onClick={() => setStep(2)}><PencilLine size={16} />返回编辑</button></div>
            <section className="confirmation-section"><div className="section-label"><h3>正文核对</h3><span className={`status ${student.bodyConfirmed ? 'done' : ''}`}>{student.bodyConfirmed ? '已确认' : '待确认'}</span></div><div className="reading-copy"><h4>{student.title || '尚未填写题目'}</h4>{(student.name || student.date) && <p className="reading-meta">{[student.name, student.date].filter(Boolean).join(' · ')}</p>}<div>{student.body || '请返回编辑，填写完整正文。'}</div></div><div className="confirm-action"><p>请核对全文、原稿归属和页序。</p><Button icon={student.bodyConfirmed ? Check : undefined} disabled={student.bodyConfirmed || !student.body.trim()} onClick={() => confirm('body')}>{student.bodyConfirmed ? '正文已确认' : '确认当前正文'}</Button></div></section>
            <section className="confirmation-section quote-section"><div className="section-label"><h3>拟用文中摘录</h3><label className="checkbox"><input type="checkbox" checked={student.includeQuote} onChange={e => apply({ includeQuote: e.target.checked })} />使用摘录</label></div>{student.includeQuote ? <><textarea className="quote-editor" aria-label="拟用文中摘录" value={student.quote} onChange={e => apply({ quote: e.target.value })} placeholder="粘贴正文中准备放进图片的一句完整原句" /><div className="confirm-action"><p className={student.quote && !isQuoteExact(student) ? 'invalid' : ''}>{student.quote && !isQuoteExact(student) ? '摘录须为正文中的完整原句，字词和标点保持一致。' : '摘录须为完整原句，确认后放入浅绿摘录区。'}</p><Button icon={student.quoteConfirmed ? Check : undefined} disabled={student.quoteConfirmed || !isQuoteExact(student)} onClick={() => confirm('quote')}>{student.quoteConfirmed ? '摘录已确认' : '确认当前摘录'}</Button></div></> : <p className="no-quote">本图不设摘录。</p>}<Field label="副标题" optional><input value={student.subtitle} onChange={e => apply({ subtitle: e.target.value })} placeholder="如需副标题，请在确认正文前填写" /></Field></section>
            {!ready && <div className="export-requirements"><Info size={17} /><span>{reasons.join('；')}。</span></div>}
            <div className="export-actions"><p>{preview ? `${preview.width} × ${preview.height} px · 每位同学单独生成` : '确认完成后，生成包含文字与原稿的完整长图。'}</p><Button primary icon={busy === 'render' ? LoaderCircle : ImageIcon} disabled={!ready || Boolean(busy)} onClick={generate}>{busy === 'render' ? '正在生成…' : preview ? '重新生成图片' : '生成下载图片'}</Button></div>
            {preview && <div className="result"><div className="result-heading"><h3><Check size={20} />长图已生成</h3><div><a className="button primary" href={preview.jpgUrl} download={`${preview.stem}.jpg`}><Download size={18} />下载 JPG</a><a className="button" href={preview.url} download={`${preview.stem}.png`}><Download size={18} />下载 PNG</a></div></div><div className="result-image"><img src={preview.url} alt={`${student.title}完整分享长图预览`} /></div><p>JPG 适合直接分享，PNG 适合高清保存。手机也可长按图片保存。下载后，本次流程即完成。</p></div>}
          </>}
        </section>
      </div>
      <footer className="page-footer"><div><FileText /><span><strong>正文与摘录，分别确认</strong><small>核对后再生成长图。</small></span></div><div><ImageIcon /><span><strong>PNG 与 JPG，直接下载</strong><small>每位同学单独生成。</small></span></div><span className="footer-note">本地处理 · 自有 API</span></footer>
      <div className="utility-row"><button className="text-button muted" onClick={() => setModal('clear')} disabled={Boolean(busy)}>清空本机草稿</button>{students.length > 1 && <button className="text-button muted" disabled={Boolean(busy)} onClick={() => setModal('delete')}>移除当前同学</button>}<span>照片与文字仅保存在当前浏览器。</span></div>
    </main>
    <nav className="mobile-nav" aria-label="手机导航"><button onClick={() => setStep(1)}><FileText size={20} />学生习作</button><button onClick={() => setModal('help')}><BookOpen size={20} />使用说明</button><button onClick={() => setModal('settings')}><Settings size={20} />API 设置</button></nav>
    {modal === 'settings' && <Modal title="AI API 设置" onClose={() => setModal(null)}><form onSubmit={saveSettings}>
      <p className="modal-intro">填写你自己的 AI 服务。识别需要支持图片输入的模型。</p><Field label="接口类型"><select name="provider" defaultValue={settings.provider} onChange={e => { const form = e.target.form; form.elements.baseUrl.value = e.target.value === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1'; form.elements.model.value = ''; }}><option value="openai">OpenAI 兼容接口</option><option value="gemini">Gemini 原生接口</option></select></Field><Field label="API 地址"><input name="baseUrl" type="url" defaultValue={settings.baseUrl} required autoComplete="off" spellCheck="false" placeholder="https://你的服务地址/v1" /></Field><Field label="模型名称"><input name="model" defaultValue={settings.model} required autoComplete="off" spellCheck="false" placeholder="填写支持图片识别的模型名称" /></Field><Field label="API 密钥"><input name="apiKey" type="password" defaultValue={settings.apiKey} required autoComplete="off" spellCheck="false" placeholder="密钥仅在当前页面使用" /></Field><div className="settings-note"><ShieldCheck size={20} /><p>密钥只保存在页面内存中，刷新后需重新填写，不会写入 GitHub。点击识别时，原稿会发送到上方配置的服务。该服务需允许浏览器跨域请求；可填写你自己的代理地址。</p></div><div className="modal-actions">{settings.apiKey && <Button type="button" onClick={() => { setSettings(s => ({ ...s, apiKey: '' })); setModal(null); tell('已从当前页面清除 API 密钥。'); }}>清除密钥</Button>}<Button type="button" onClick={() => setModal(null)}>取消</Button><Button primary type="submit">保存设置</Button></div>
    </form></Modal>}
    {modal === 'help' && <Modal title="使用说明" onClose={() => setModal(null)}><ol className="help-list"><li><strong>按同学上传照片</strong><p>每位同学单独添加，可多选照片，使用上下箭头调整页序。拍摄时保持清晰、完整、方向正确。</p></li><li><strong>识别并对照原稿</strong><p>在 API 设置中填写自己的接口和多模态模型，点击识别；已有转写文字可直接粘贴。保留孩子原意，只做最小校订。</p></li><li><strong>分别确认正文和摘录</strong><p>修正疑难字后确认全文。摘录必须逐字来自正文，也可关闭摘录。修改文字、原稿或副标题后需要重新确认。</p></li><li><strong>生成并下载图片</strong><p>长图包含完整文字和逐页手写原稿，宽 1440 px。下载 JPG 直接分享，或下载 PNG 高清保存。</p></li></ol><div className="help-data"><strong>关于数据保存</strong><p>习作草稿保存在当前浏览器，可清空；不在不同设备间同步。浏览器清理或隐私模式可能导致草稿丢失。重新打开草稿后，需要再次核对确认。AI 识别会使用你自己的 API 额度。</p></div><div className="modal-actions"><Button primary onClick={() => setModal(null)}>开始整理</Button></div></Modal>}
    {modal === 'original' && currentPage && <Modal title={`手写原稿 · 第 ${Math.min(pageIndex + 1, student.pages.length)} 页`} onClose={() => { setModal(null); setZoom(100); }} wide><div className="zoom-controls"><label>缩放 <input aria-label="原稿缩放比例" type="range" min="70" max="220" step="10" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><span>{zoom}%</span><Button disabled={pageIndex === 0} onClick={() => { setPageIndex(i => i - 1); setZoom(100); }} icon={ChevronLeft}>上一页</Button><Button disabled={pageIndex >= student.pages.length - 1} onClick={() => { setPageIndex(i => i + 1); setZoom(100); }} icon={ChevronRight}>下一页</Button></div><div className="zoom-viewport"><img src={currentPage.dataUrl} alt={`手写原稿第 ${pageIndex + 1} 页放大图`} style={{ width: `${zoom}%`, maxWidth: 'none' }} /></div></Modal>}
    {modal === 'replace' && <Modal title="重新识别这篇习作？" onClose={() => setModal(null)}><p className="modal-intro">新的识别结果会替换当前正文和摘录，已完成的确认也会重置。</p><div className="modal-actions"><Button onClick={() => setModal(null)}>取消</Button><Button primary onClick={() => { setReplaceRequest(true); setModal('replace-ready'); }}>继续识别</Button></div></Modal>}
    {modal === 'replace-ready' && <RunOnce action={() => recognize()} />}
    {modal === 'clear' && <Modal title="清空本机习作草稿？" onClose={() => setModal(null)}><p className="modal-intro">将删除这个浏览器保存的全部原稿和整理文字。已下载的图片不受影响。</p><div className="modal-actions"><Button onClick={() => setModal(null)}>取消</Button><Button primary onClick={clearAll}>确认清空</Button></div></Modal>}
    {modal === 'delete' && <Modal title="移除当前同学？" onClose={() => setModal(null)}><p className="modal-intro">将移除这位同学的原稿和文字，请先下载需要保留的成果。</p><div className="modal-actions"><Button onClick={() => setModal(null)}>取消</Button><Button primary onClick={() => { const remaining = students.filter(s => s.id !== student.id); setStudents(remaining); setActiveId(remaining[0].id); setModal(null); setStep(1); }}>确认移除</Button></div></Modal>}
  </>;
}
function RunOnce({ action }) { useEffect(() => { action(); }, []); return null; }
