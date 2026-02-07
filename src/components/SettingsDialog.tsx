import { Settings, X, Moon, Sun, Monitor } from 'lucide-react';

const SettingsDialog = ({ isOpen, onClose, appSettings, setAppSettings, theme, setTheme }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-[600px] overflow-hidden flex flex-col max-h-[85vh] border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Settings size={18} className="text-blue-600"/> Settings & Preferences
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400 transition-colors"><X size={18}/></button>
                </div>
                <div className="p-6 overflow-y-auto space-y-8">
                    {/* Theme Section */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Appearance</h4>
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { id: 'light', icon: Sun, label: 'Light Mode' },
                                { id: 'dark', icon: Moon, label: 'Dark Mode' },
                                { id: 'system', icon: Monitor, label: 'System' }
                            ].map(t => (
                                <button key={t.id} onClick={() => setTheme(t.id)} 
                                    className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all gap-2 ${theme === t.id ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400'}`}>
                                    <t.icon size={24}/>
                                    <span className="text-xs font-medium">{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Defaults Section */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Defaults</h4>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Line Width</label>
                                    <span className="text-xs font-mono text-slate-500">{appSettings.defaultLineWidth}px</span>
                                </div>
                                <input type="range" min="1" max="10" value={appSettings.defaultLineWidth} onChange={e => setAppSettings({...appSettings, defaultLineWidth: parseInt(e.target.value)})} className="w-full accent-blue-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Box Opacity</label>
                                    <span className="text-xs font-mono text-slate-500">{appSettings.defaultBoxOpacity}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.1" value={appSettings.defaultBoxOpacity} onChange={e => setAppSettings({...appSettings, defaultBoxOpacity: parseFloat(e.target.value)})} className="w-full accent-blue-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Show Crosshair</label>
                                <input type="checkbox" checked={appSettings.showCrosshair} onChange={e => setAppSettings({...appSettings, showCrosshair: e.target.checked})} className="accent-blue-600 w-4 h-4 rounded cursor-pointer"/>
                            </div>
                        </div>
                    </div>
                    {/* Shortcuts Cheat Sheet */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Keyboard Shortcuts</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            {[
                                ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
                                ['Pan View', 'Left Drag'],
                                ['Zoom', 'Mouse Wheel'],
                                ['Delete Selected', 'Delete'],
                                ['Delete Network', 'Ctrl + Delete'],
                                ['Remove File', 'Shift + Delete'],
                                ['Tools (S/R/E/W)', 'Select/Comp/Port/Wire'],
                                ['Toggle Ports', 'P'],
                                ['Toggle Labels', 'L'],
                                ['Hide Text Labels', 'H']
                            ].map(([k, v]) => (
                                <div key={k} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
                                    <span className="text-slate-600 dark:text-slate-400">{k}</span>
                                    <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-300">{v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-colors">Done</button>
                </div>
            </div>
        </div>
    );
};

export default SettingsDialog;
