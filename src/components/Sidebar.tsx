import React from 'react';
import useStore from '../store';
import { Upload, FileJson, BoxSelect, Circle, Network, Save, RotateCcw, RotateCw, Trash2, Edit3 } from 'lucide-react';
import { cn } from '../lib/utils';

const Sidebar = () => {
  const { 
    mode, setMode, 
    undo, redo, 
    setImage, loadJson, exportJson, 
    nodes, edges, deleteSelection, 
    updateNodeLabel, updateNodeType
  } = useStore();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(event.target?.result as string, img.width, img.height);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        if (event.target?.result) loadJson(event.target.result as string);
    };
    reader.readAsText(file);
  };

  const handleSave = () => {
      const json = exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'circuit_annotation.json';
      a.click();
      URL.revokeObjectURL(url);
  };

  // Selection Info
  const selectedNode = nodes.find(n => n.selected);
  const selectedEdge = edges.find(e => e.selected);
  
  const getTip = () => {
      switch(mode) {
          case 'VIEW': return '【查看/编辑】点击对象选中。选组件/端口高亮整个网络；选连线高亮单根。';
          case 'ADD_COMP': return '【画框模式】拖拽画框创建组件。';
          case 'ADD_PORT': return '【端口模式】点击组件添加端口。';
          case 'CONNECT': return '【连线模式】点击端口A -> 端口B。';
          default: return '';
      }
  };

  return (
    <div className="w-72 h-full bg-white border-r border-gray-300 flex flex-col shadow-xl z-20 flex-shrink-0">
      {/* Header */}
      <div className="h-14 bg-slate-800 flex items-center px-3 shadow-lg flex-shrink-0">
        <Network className="w-6 h-6 text-white mr-2" />
        <h1 className="text-white font-bold text-lg truncate">Circuit Labeler Pro</h1>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto flex-1 bg-gray-50">
        
        {/* Toolbar Row */}
        <div className="flex gap-2 justify-end">
            <button onClick={undo} className="p-1.5 bg-white border rounded shadow-sm hover:bg-gray-100 text-gray-700" title="Undo (Ctrl+Z)"><RotateCcw size={16}/></button>
            <button onClick={redo} className="p-1.5 bg-white border rounded shadow-sm hover:bg-gray-100 text-gray-700" title="Redo (Ctrl+Y)"><RotateCw size={16}/></button>
            <button onClick={handleSave} className="ml-auto px-3 py-1.5 bg-green-600 text-white rounded shadow hover:bg-green-700 flex items-center gap-1 text-sm font-bold">
                <Save size={16}/> Save JSON
            </button>
        </div>

        {/* 1. File Loading */}
        <div className="bg-white p-3 rounded shadow-sm border border-gray-200">
            <h3 className="text-xs font-bold text-slate-500 mb-2">1. 文件加载</h3>
            <div className="space-y-2">
                <label className="flex w-full cursor-pointer bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 p-2 rounded text-sm items-center justify-center gap-2 transition-colors">
                    <Upload size={16} /> 加载图片
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                <label className="flex w-full cursor-pointer bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 p-2 rounded text-sm items-center justify-center gap-2 transition-colors">
                    <FileJson size={16} /> 加载 JSON
                    <input type="file" accept=".json" onChange={handleJsonUpload} className="hidden" />
                </label>
            </div>
        </div>

        {/* 2. Mode */}
        <div className="bg-white p-3 rounded shadow-sm border border-gray-200">
            <h3 className="text-xs font-bold text-slate-500 mb-2">2. 模式</h3>
            <div className="space-y-2">
                <button 
                    onClick={() => setMode('VIEW')}
                    className={cn("w-full p-2 rounded text-sm flex items-center gap-3 border transition-all font-medium", mode === 'VIEW' ? "bg-slate-800 text-white border-slate-800 shadow-md transform scale-[1.02]" : "bg-white text-gray-700 hover:bg-gray-50")}
                >
                    <Edit3 size={18} /> 查看/编辑
                </button>
                <button 
                    onClick={() => setMode('ADD_COMP')}
                    className={cn("w-full p-2 rounded text-sm flex items-center gap-3 border transition-all font-medium", mode === 'ADD_COMP' ? "bg-blue-600 text-white border-blue-600 shadow-md transform scale-[1.02]" : "bg-white text-gray-700 hover:bg-gray-50")}
                >
                    <BoxSelect size={18} /> 新增组件
                </button>
                <button 
                    onClick={() => setMode('ADD_PORT')}
                    className={cn("w-full p-2 rounded text-sm flex items-center gap-3 border transition-all font-medium", mode === 'ADD_PORT' ? "bg-purple-600 text-white border-purple-600 shadow-md transform scale-[1.02]" : "bg-white text-gray-700 hover:bg-gray-50")}
                >
                    <Circle size={18} /> 新增端口
                </button>
                <button 
                    onClick={() => setMode('CONNECT')}
                    className={cn("w-full p-2 rounded text-sm flex items-center gap-3 border transition-all font-medium", mode === 'CONNECT' ? "bg-green-600 text-white border-green-600 shadow-md transform scale-[1.02]" : "bg-white text-gray-700 hover:bg-gray-50")}
                >
                    <Network size={18} /> 连线模式
                </button>
            </div>
        </div>
        
        {/* Status Tip */}
        <div className="bg-yellow-50 text-yellow-800 text-xs p-2 rounded border border-yellow-200">
            {getTip()}
        </div>

        <div className="border-t border-gray-200 my-2"></div>

        {/* Properties Panel */}
        <div className="bg-white p-3 rounded shadow-sm border border-gray-200 flex-1 flex flex-col">
             <h3 className="text-xs font-bold text-slate-500 mb-3">属性编辑</h3>
             {!selectedNode && !selectedEdge && <div className="text-gray-400 italic text-sm text-center py-4">未选中对象</div>}
             
             {selectedNode && (
                 <div className="space-y-4">
                     {selectedNode.type === 'component' && (
                         <>
                            <div>
                                <label className="text-xs font-bold text-gray-600 block mb-1">名称</label>
                                <input 
                                    className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={selectedNode.data.label || ''} 
                                    onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-600 block mb-1">类型</label>
                                <input 
                                    className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={selectedNode.data.type || ''} 
                                    onChange={(e) => updateNodeType(selectedNode.id, e.target.value)}
                                />
                            </div>
                         </>
                     )}
                     
                     {selectedNode.type === 'port' && (
                         <>
                            <div>
                                <label className="text-xs font-bold text-gray-600 block mb-1">端口名称</label>
                                <input 
                                    className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={selectedNode.data.label || ''} 
                                    onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                                />
                            </div>
                            {selectedNode.data.isExternal && (
                                <div>
                                    <label className="text-xs font-bold text-gray-600 block mb-1">类型</label>
                                    <input 
                                        className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                                        value={selectedNode.data.type || ''} 
                                        onChange={(e) => updateNodeType(selectedNode.id, e.target.value)}
                                    />
                                </div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                                所属: {selectedNode.data.isExternal ? "外部端口" : (selectedNode.data.componentName || "未知组件")}
                            </div>
                         </>
                     )}

                     {selectedNode.type === 'junction' && (
                         <div className="text-center">
                            <div className="text-lg text-green-700 font-bold mb-2">连接网络 (中心)</div>
                            <div className="text-xs text-gray-500 mb-2">删除中心将删除整个网络</div>
                         </div>
                     )}

                     <button onClick={deleteSelection} className="w-full bg-red-50 text-red-600 border border-red-200 p-2 rounded hover:bg-red-100 text-sm flex items-center justify-center gap-2 mt-4 transition-colors">
                         <Trash2 size={16}/> 删除
                     </button>
                 </div>
             )}
             
             {selectedEdge && !selectedNode && (
                 <div className="space-y-4">
                     <div className="text-lg text-green-600 font-bold text-center">连线分支 (单根)</div>
                     <button onClick={deleteSelection} className="w-full bg-orange-50 text-orange-600 border border-orange-200 p-2 rounded hover:bg-orange-100 text-sm flex items-center justify-center gap-2 mt-4 transition-colors">
                         <Trash2 size={16}/> 断开 此连线
                     </button>
                 </div>
             )}
        </div>

      </div>
    </div>
  );
};

export default Sidebar;
