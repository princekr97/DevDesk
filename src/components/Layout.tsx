import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
    FileJson,
    GitCompare,
    FileSpreadsheet,
    FileText,
    Menu,
    X,
    ArrowRightLeft,
} from 'lucide-react';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { ROUTE_METADATA } from '../config/routes';
import { useAppStore } from '../store/AppContext';
import { Logo } from './Logo';
import { useDraftPreference } from '../hooks/useDraftPreference';

type IdleCallbackWindow = Window & typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
};

interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    path: string;
    category: string;
}

const navItems: NavItem[] = [
    {
        id: 'json-viewer',
        label: 'JSON Structure Viewer',
        icon: <FileJson className="w-5 h-5" />,
        path: '/app/json-viewer',
        category: 'JSON Tools',
    },
    {
        id: 'diff-checker',
        label: 'Diff Checker',
        icon: <GitCompare className="w-5 h-5" />,
        path: '/app/diff-checker',
        category: 'Diff Tools',
    },
    {
        id: 'json-excel',
        label: 'JSON ⇄ Excel',
        icon: <FileSpreadsheet className="w-5 h-5" />,
        path: '/app/json-excel',
        category: 'File Converters',
    },
    {
        id: 'json-csv',
        label: 'JSON ⇄ CSV',
        icon: <FileText className="w-5 h-5" />,
        path: '/app/json-csv',
        category: 'File Converters',
    },
    {
        id: 'excel-csv',
        label: 'Excel ⇄ CSV',
        icon: <ArrowRightLeft className="w-5 h-5" />,
        path: '/app/excel-csv',
        category: 'File Converters',
    },
    {
        id: 'word-pdf',
        label: 'Word ⇄ PDF',
        icon: <FileText className="w-5 h-5" />,
        path: '/app/word-pdf',
        category: 'File Converters',
    },
];

const Layout: React.FC = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false); // Default closed on mobile
    const location = useLocation();
    const { open, setOpen } = useCommandPalette();
    const { state, setTaskStatus } = useAppStore();
    const { enabled: draftsEnabled, setEnabled: setDraftsEnabled } = useDraftPreference();
    const isWideWorkspace = location.pathname === '/app/json-viewer' || location.pathname === '/app/diff-checker';
    const preloadedRoutesRef = React.useRef<Set<string>>(new Set());

    const preloadRoute = React.useCallback((path: string) => {
        if (preloadedRoutesRef.current.has(path)) return;
        const metadata = ROUTE_METADATA[path as keyof typeof ROUTE_METADATA];
        if (!metadata?.preload) return;

        preloadedRoutesRef.current.add(path);
        metadata.preload().catch(() => {
            preloadedRoutesRef.current.delete(path);
        });
    }, []);

    React.useEffect(() => {
        const preloadLikelyNextRoute = () => {
            const likelyByRoute: Record<string, string> = {
                '/app/json-viewer': '/app/diff-checker',
                '/app/diff-checker': '/app/json-viewer',
                '/app/json-excel': '/app/json-csv',
                '/app/json-csv': '/app/excel-csv',
                '/app/excel-csv': '/app/json-csv',
                '/app/word-pdf': '/app/json-viewer',
            };
            const nextRoute = likelyByRoute[location.pathname];
            if (nextRoute) preloadRoute(nextRoute);
        };

        const idleWindow = window as IdleCallbackWindow;
        if (idleWindow.requestIdleCallback) {
            const id = idleWindow.requestIdleCallback(preloadLikelyNextRoute, { timeout: 2000 });
            return () => idleWindow.cancelIdleCallback?.(id);
        }

        const timer = globalThis.setTimeout(preloadLikelyNextRoute, 1200);
        return () => globalThis.clearTimeout(timer);
    }, [preloadRoute, location.pathname]);

    React.useEffect(() => {
        if (state.taskStatus.state === 'running' || state.taskStatus.state === 'idle') return;
        const timer = globalThis.setTimeout(() => {
            setTaskStatus({ state: 'idle', label: '' });
        }, 2200);
        return () => globalThis.clearTimeout(timer);
    }, [state.taskStatus.state, state.taskStatus.updatedAt, setTaskStatus]);

    // Group nav items by category
    const groupedItems = navItems.reduce((acc, item) => {
        if (!acc[item.category]) {
            acc[item.category] = [];
        }
        acc[item.category].push(item);
        return acc;
    }, {} as Record<string, NavItem[]>);

    return (
        <div className="app-shell-bg relative flex h-screen overflow-hidden font-sans">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-20 -right-24 w-[30rem] h-[30rem] rounded-full bg-indigo-200/20 blur-[120px]" />
                <div className="absolute top-1/3 -left-24 w-[28rem] h-[28rem] rounded-full bg-cyan-200/18 blur-[120px]" />
                <div className="absolute bottom-[-5rem] right-1/4 w-[22rem] h-[22rem] rounded-full bg-slate-200/20 blur-[110px]" />
            </div>
            {/* Command Palette */}
            <CommandPalette open={open} onOpenChange={setOpen} />
            {/* Sidebar */}
            <aside
                className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    } fixed inset-y-0 left-0 z-50 w-64 bg-white/88 backdrop-blur-md border-r border-slate-200/80 shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition-transform duration-300 ease-in-out lg:relative lg:z-10 lg:translate-x-0`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b border-slate-200/80">
                        <Link to="/" className="block">
                            <Logo
                                className="w-10 h-10 sm:w-11 sm:h-11 shadow-xl shadow-indigo-500/20"
                                showText={true}
                                animated={false}
                            />
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto custom-scrollbar">
                        {Object.entries(groupedItems).map(([category, items]) => (
                            <div key={category}>
                                <h3 className="px-3 text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-[0.12em]">
                                    {category}
                                </h3>
                                <div className="space-y-1">
                                    {items.map((item) => {
                                        const isActive = location.pathname === item.path;
                                        return (
                                            <Link
                                                key={item.id}
                                                to={item.path}
                                                onClick={() => setSidebarOpen(false)}
                                                onMouseEnter={() => preloadRoute(item.path)}
                                                onFocus={() => preloadRoute(item.path)}
                                                onTouchStart={() => preloadRoute(item.path)}
                                                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive
                                                    ? 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100'
                                                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                                                    }`}
                                            >
                                                <div className={isActive ? 'text-indigo-600' : 'text-gray-400'}>
                                                    {item.icon}
                                                </div>
                                                <span>{item.label}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </nav>

                    {/* Footer Info */}
                    {/* <div className="p-4 border-t border-gray-200">
                        <div className="text-xs text-gray-500 text-center">
                            100% Local Processing
                        </div>
                    </div> */}
                </div>
            </aside>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col min-w-0 bg-transparent">
                {/* Header */}
                <header className="h-14 flex items-center justify-between px-6 bg-white/76 backdrop-blur-md border-b border-slate-200/80 shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className="lg:hidden p-2 text-slate-600 hover:bg-white rounded-md border border-transparent hover:border-slate-200"
                            aria-label="Toggle sidebar"
                        >
                            {sidebarOpen ? (
                                <X className="w-5 h-5" />
                            ) : (
                                <Menu className="w-5 h-5" />
                            )}
                        </button>
                        <h2 className="text-sm font-semibold text-slate-900">
                            {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
                        </h2>
                    </div>
                    {state.taskStatus.state !== 'idle' && (
                        <div className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${state.taskStatus.state === 'running'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : state.taskStatus.state === 'done'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : state.taskStatus.state === 'cancelled'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                            }`}>
                            {state.taskStatus.state.toUpperCase()} {state.taskStatus.label ? `• ${state.taskStatus.label}` : ''}
                        </div>
                    )}
                    <label className="hidden md:flex items-center gap-2 text-[11px] font-semibold text-slate-600 bg-white/80 border border-slate-200 rounded-md px-2.5 py-1">
                        <input
                            type="checkbox"
                            checked={draftsEnabled}
                            onChange={(e) => setDraftsEnabled(e.target.checked)}
                            className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                        />
                        <span>Remember drafts on this device (60 min session)</span>
                    </label>

                    {/* <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600 bg-gray-100 px-3 py-1.5 rounded-md">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="font-medium">Local</span>
                        </div>
                        <a
                            href="https://github.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 hover:bg-gray-100 rounded-md transition-colors"
                        >
                            GitHub
                        </a>
                    </div> */}
                </header>

                <div className={`flex-1 overflow-auto ${isWideWorkspace ? 'p-3 sm:p-4' : 'p-6'}`}>
                    <div className={`${isWideWorkspace ? 'max-w-none' : 'max-w-[1600px] mx-auto'} h-full`}>
                        <Outlet />
                    </div>
                </div>

                {/* Footer */}
                <footer className="bg-white/78 backdrop-blur-md border-t border-slate-200/80 py-3 px-6 shrink-0">
                    <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-gray-500">
                        {/* <div className="flex items-center gap-2">
                            <span className="font-medium">DevDesk v1.0.0</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="hidden sm:inline">100% Local Processing</span>
                        </div> */}
                        <div className="font-semibold text-xs">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600">
                                © 2026 DevDesk •
                            </span>
                            <span className="mx-1 emoji text-slate-700">👨🏻‍💻</span>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600">
                                Developed by Prince Gupta
                            </span>
                        </div>
                    </div>
                </footer>
            </main>

            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/20 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}
        </div>
    );
};

export default Layout;
