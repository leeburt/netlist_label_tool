import { useCallback, useEffect, useState } from 'react';
import { Server, Folder, FileImage, X, Loader2 } from 'lucide-react';
import { getId } from '../utils/commonUtils';
import { pythonDataToReactState } from '../utils/netlistUtils';
import { imageRelPathToJsonRelPath } from '../utils/workspaceUtils';

type Entry = { name: string; kind: 'directory' | 'file' };

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

function joinRel(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

export type ServerWorkspaceNewFile = {
  id: string;
  name: string;
  imgFile: File;
  source: 'server';
  serverImageRelPath: string;
  serverJsonRelPath: string;
  data: { nodes: any[]; edges: any[] } | null;
  serverExtraData?: any;
  status: 'annotated' | 'new';
};

export default function ServerWorkspaceModal({
  open,
  onClose,
  onAdd,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (files: ServerWorkspaceNewFile[]) => void;
  notify: (msg: string | null) => void;
}) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const loadList = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ path: p });
        const r = await fetch(`/api/workspace/list?${q}`);
        const data = await r.json();
        if (!r.ok) {
          notify(data.error || '无法列出目录');
          setEntries([]);
          return;
        }
        setEntries(data.entries || []);
        setPath(typeof data.path === 'string' ? data.path : p);
      } catch (e) {
        notify(String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    (async () => {
      try {
        const sr = await fetch('/api/workspace/status');
        const st = await sr.json();
        setEnabled(!!st.enabled);
        if (st.enabled) await loadList('');
        else setEntries([]);
      } catch {
        setEnabled(false);
        setEntries([]);
      }
    })();
  }, [open, loadList]);

  if (!open) return null;

  const toggleSelect = (name: string, kind: string) => {
    if (kind !== 'file' || !IMAGE_RE.test(name)) return;
    const rel = joinRel(path, name);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  const openDir = (name: string) => {
    loadList(joinRel(path, name));
    setSelected(new Set());
  };

  const goUp = () => {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    loadList(parts.join('/'));
  };

  const ingestPaths = async (rels: string[]) => {
    setLoading(true);
    const newFiles: ServerWorkspaceNewFile[] = [];
    const failedFiles: string[] = [];
    const concurrency = 10; // JSON 并发可以更高
    let completed = 0;
    const total = rels.length;

    try {
      // 只加载 JSON，不预下载图片（图片懒加载）
      const loadSingleFile = async (rel: string): Promise<ServerWorkspaceNewFile | null> => {
        const cacheBuster = `t=${Date.now()}`;
        const baseName = rel.split('/').pop() || 'image.png';
        const jsonRel = imageRelPathToJsonRelPath(rel);

        let data: { nodes: any[]; edges: any[] } | null = null;
        let serverExtraData: any = undefined;
        let status: 'annotated' | 'new' = 'new';

        try {
          // 只尝试加载 JSON，图片在真正需要时才加载
          const jr = await fetch(`/api/workspace/file?path=${encodeURIComponent(jsonRel)}&${cacheBuster}`);
          if (jr.ok) {
            const txt = await jr.text();
            const parsed = pythonDataToReactState(txt);
            if (parsed) {
              data = { nodes: parsed.nodes, edges: parsed.edges };
              status = 'annotated';
              if (parsed.extraData) serverExtraData = parsed.extraData;
            }
          }
        } catch {
          /* 无同名 JSON 时忽略 */
        }

        completed++;
        if (total > 10) {
          notify(`加载中... ${completed}/${total} (${Math.round(completed / total * 100)}%)`);
        }

        return {
          id: getId(),
          name: baseName,
          imgFile: undefined as any, // 占位，不实际加载图片
          source: 'server',
          serverImageRelPath: rel,
          serverJsonRelPath: jsonRel,
          data,
          serverExtraData,
          status,
        };
      };

      // 使用并发池控制
      const results: ServerWorkspaceNewFile[] = [];
      for (let i = 0; i < rels.length; i += concurrency) {
        const batch = rels.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(loadSingleFile));
        results.push(...batchResults.filter((r): r is ServerWorkspaceNewFile => r !== null));
      }

      newFiles.push(...results);

      if (newFiles.length > 0) {
        onAdd(newFiles);
        let msg = `已从服务器工作区添加 ${newFiles.length} 个文件`;
        if (failedFiles.length > 0) {
          msg += ` (${failedFiles.length} 个文件加载失败)`;
        }
        notify(msg);
        onClose();
      } else if (failedFiles.length > 0) {
        notify(`所有文件加载失败 (${failedFiles.length} 个)`);
      }
    } finally {
      setLoading(false);
    }
  };

  const addSelected = async () => {
    if (selected.size === 0) {
      notify('请先选择图片文件');
      return;
    }
    await ingestPaths([...selected]);
  };

  const addAllImages = async () => {
    const imgs = entries.filter((e) => e.kind === 'file' && IMAGE_RE.test(e.name));
    if (imgs.length === 0) {
      notify('当前目录没有图片');
      return;
    }
    const rels = imgs.map((e) => joinRel(path, e.name));
    await ingestPaths(rels);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
            <Server size={18} className="text-emerald-600 dark:text-emerald-400" />
            从服务器工作区打开
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
          {enabled === false && (
            <p className="text-amber-600 dark:text-amber-400">
              服务端未配置工作区目录。请在部署时设置环境变量{' '}
              <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">NETLIST_WORKSPACE_ROOT</code>{' '}
              为服务器上的绝对路径，并重启服务。
            </p>
          )}
          {enabled && (
            <p>
              浏览的是服务器磁盘上该目录内的文件（非本机浏览器路径）。保存网表时将写回同名的{' '}
              <code className="font-mono">.json</code>，无需下载。
            </p>
          )}
        </div>

        <div className="px-3 py-2 flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            disabled={!path || loading}
            onClick={goUp}
            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
          >
            上级
          </button>
          <span className="truncate flex-1" title={path || '(根目录)'}>
            /{path}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] p-2 custom-scrollbar">
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((e) => {
                const rel = joinRel(path, e.name);
                const isImg = e.kind === 'file' && IMAGE_RE.test(e.name);
                const isSel = selected.has(rel);
                return (
                  <li key={e.name}>
                    {e.kind === 'directory' ? (
                      <button
                        type="button"
                        onClick={() => openDir(e.name)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Folder size={16} className="text-amber-500 shrink-0" />
                        <span className="truncate">{e.name}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSelect(e.name, e.kind)}
                        disabled={!isImg}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm ${
                          isImg
                            ? isSel
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            : 'text-slate-400 dark:text-slate-600 cursor-default opacity-60'
                        }`}
                      >
                        <FileImage size={16} className="text-slate-400 shrink-0" />
                        <span className="truncate">{e.name}</span>
                      </button>
                    )}
                  </li>
                );
              })}
              {enabled && !loading && entries.length === 0 && (
                <li className="text-center text-xs text-slate-400 py-8">目录为空</li>
              )}
            </ul>
          )}
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!enabled || loading}
              onClick={addSelected}
              className="flex-1 py-2 text-xs font-bold rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              添加选中图片
            </button>
            <button
              type="button"
              disabled={!enabled || loading}
              onClick={addAllImages}
              className="flex-1 py-2 text-xs font-bold rounded bg-slate-700 text-white hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 disabled:opacity-40"
            >
              添加当前目录全部图片
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
