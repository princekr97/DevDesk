import React from 'react';
import { ChevronDown, Check, FolderTree, Clipboard, Key } from 'lucide-react';
import type { JsonNode } from '../types/json';
import { copyToClipboard } from '../utils/jsonUtils';

interface VirtualizedJsonTreeProps {
    data: JsonNode;
    searchQuery?: string;
    defaultExpanded?: boolean;
    externalExpandedPaths?: Set<string>;
    onToggle?: (path: string) => void;
}

interface FlatNode {
    node: JsonNode;
    depth: number;
    hasChildren: boolean;
    path: string;
}

const ROW_HEIGHT = 32;

const getTypeColor = (type: string) => {
    switch (type) {
        case 'string': return 'text-emerald-500';
        case 'number': return 'text-sky-500';
        case 'boolean': return 'text-amber-500';
        case 'null': return 'text-slate-400';
        case 'array': return 'text-indigo-500';
        case 'object': return 'text-violet-500';
        default: return 'text-slate-600';
    }
};

const VirtualizedJsonTree: React.FC<VirtualizedJsonTreeProps> = ({
    data,
    searchQuery = '',
    defaultExpanded = false,
    externalExpandedPaths,
    onToggle
}) => {
    const [internalExpandedPaths, setInternalExpandedPaths] = React.useState<Set<string>>(() => new Set(['root']));
    const [copiedPath, setCopiedPath] = React.useState<string | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(600);
    const resizeRafRef = React.useRef<number | null>(null);
    const scrollRafRef = React.useRef<number | null>(null);
    const pendingScrollTopRef = React.useRef(0);

    const expandedPaths = externalExpandedPaths || internalExpandedPaths;

    // Observe container size and batch height updates on animation frame.
    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            const nextHeight = entries[0]?.contentRect.height;
            if (!nextHeight) return;

            if (resizeRafRef.current !== null) {
                cancelAnimationFrame(resizeRafRef.current);
            }
            resizeRafRef.current = requestAnimationFrame(() => {
                setViewportHeight(prev => (Math.abs(prev - nextHeight) > 1 ? nextHeight : prev));
                resizeRafRef.current = null;
            });
        });

        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            if (resizeRafRef.current !== null) {
                cancelAnimationFrame(resizeRafRef.current);
            }
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current);
            }
        };
    }, []);

    const visibleNodes = React.useMemo(() => {
        const result: FlatNode[] = [];
        const stack: { node: JsonNode, depth: number }[] = [{ node: data, depth: 0 }];
        const CHILD_LIMIT = 200; // Hard cap per node
        const GLOBAL_RENDER_LIMIT = 15000; // Circuit Breaker for total DOM nodes

        while (stack.length > 0) {
            // Safety Break: Stop calculating if we exceed the render budget
            if (result.length >= GLOBAL_RENDER_LIMIT) {
                result.push({
                    node: {
                        key: '⚠️ VIEW TRUNCATED',
                        value: `Stopped rendering after ${GLOBAL_RENDER_LIMIT.toLocaleString()} nodes to preserve browser performance. Collapse some nodes to see more.`,
                        type: 'null',
                        path: 'truncated-global'
                    },
                    depth: 1,
                    hasChildren: false,
                    path: 'truncated-global'
                });
                break;
            }

            const { node, depth } = stack.pop()!;
            const hasChildren = !!(node.children && node.children.length > 0);

            result.push({
                node,
                depth,
                hasChildren,
                path: node.path
            });

            if (hasChildren && (defaultExpanded || expandedPaths.has(node.path))) {
                if (node.children) {
                    const count = node.children.length;

                    // If massive array/object, truncate for performance
                    if (count > CHILD_LIMIT) {
                        // 1. Add "Truncated" message at the END (pushed first to stack)
                        const remaining = count - CHILD_LIMIT;
                        const placeholderNode: JsonNode = {
                            key: `...and ${remaining} more items`,
                            value: 'Use search to find specific items',
                            type: 'null',
                            path: `${node.path}.truncated`
                        };

                        stack.push({ node: placeholderNode, depth: depth + 1 });

                        // 2. Add first N items
                        for (let i = CHILD_LIMIT - 1; i >= 0; i--) {
                            stack.push({ node: node.children[i], depth: depth + 1 });
                        }
                    } else {
                        // Normal behavior
                        for (let i = count - 1; i >= 0; i--) {
                            stack.push({ node: node.children[i], depth: depth + 1 });
                        }
                    }
                }
            }
        }
        return result;
    }, [data, expandedPaths, defaultExpanded]);

    const toggleExpand = (path: string) => {
        if (onToggle) {
            onToggle(path);
        } else {
            setInternalExpandedPaths(prev => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
            });
        }
    };

    const handleCopy = async (path: string) => {
        const success = await copyToClipboard(path);
        if (success) {
            setCopiedPath(path);
            setTimeout(() => setCopiedPath(null), 2000);
        }
    };

    const handleScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
        pendingScrollTopRef.current = e.currentTarget.scrollTop;
        if (scrollRafRef.current !== null) return;

        scrollRafRef.current = requestAnimationFrame(() => {
            setScrollTop(prev => (prev !== pendingScrollTopRef.current ? pendingScrollTopRef.current : prev));
            scrollRafRef.current = null;
        });
    }, []);

    // Virtualization calculations
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
    const endIndex = Math.min(visibleNodes.length, Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + 5);
    const totalHeight = visibleNodes.length * ROW_HEIGHT;
    const windowedNodes = React.useMemo(
        () => visibleNodes.slice(startIndex, endIndex),
        [visibleNodes, startIndex, endIndex]
    );

    const searchRegex = React.useMemo(() => {
        if (!searchQuery) return null;
        try {
            const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(${escapedQuery})`, 'gi');
        } catch (e) {
            return null;
        }
    }, [searchQuery]);

    const highlightText = React.useCallback((text: string) => {
        if (!searchRegex || !searchQuery) return text;
        const parts = text.split(searchRegex);
        return parts.map((part, i) =>
            part.toLowerCase() === searchQuery.toLowerCase() ?
                <mark key={i} className="bg-indigo-500 text-white rounded-sm px-0.5 font-bold mx-0.5 shadow-sm">{part}</mark> :
                part
        );
    }, [searchRegex, searchQuery]);

    const renderValue = (node: JsonNode) => {
        if (node.type === 'object') {
            const count = node.children?.length || 0;
            return <span className="text-[10px] font-black uppercase opacity-40 ml-1">{count} Props</span>;
        }
        if (node.type === 'array') {
            const count = node.children?.length || 0;
            return <span className="text-[10px] font-black uppercase opacity-40 ml-1">{count} Items</span>;
        }
        const val = String(node.value);
        return <span className={node.type === 'string' ? 'font-bold' : 'font-bold'}>
            {node.type === 'string' ? '"' : ''}
            {highlightText(val)}
            {node.type === 'string' ? '"' : ''}
        </span>;
    };

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="w-full h-full overflow-auto custom-scrollbar relative"
        >
            <div style={{ height: totalHeight, minWidth: '100%', width: 'max-content', position: 'relative' }}>
                {windowedNodes.map((flatNode, i) => {
                    const actualIndex = startIndex + i;
                    const { node, depth, hasChildren, path } = flatNode;
                    const isExpanded = defaultExpanded || expandedPaths.has(path);

                    return (
                        <div
                            key={path}
                            className="absolute left-0 min-w-full w-max flex items-center group hover:bg-indigo-50/30 px-2 rounded-lg transition-colors font-mono text-xs border border-transparent hover:border-indigo-100/30"
                            style={{
                                top: 0,
                                transform: `translateY(${actualIndex * ROW_HEIGHT}px)`,
                                height: ROW_HEIGHT,
                                paddingLeft: depth * 20 + 8
                            }}
                        >
                            <button
                                onClick={() => toggleExpand(path)}
                                className={`p-1 rounded hover:bg-white transition-all ${hasChildren ? 'cursor-pointer' : 'invisible opacity-0'}`}
                            >
                                <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                </div>
                            </button>

                            <span className="font-bold text-slate-800 mr-2 flex-shrink-0">
                                {highlightText(node.key)}
                                <span className="text-gray-300 ml-1">:</span>
                            </span>

                            <span className={`${getTypeColor(node.type)} flex-none whitespace-nowrap`}>
                                {renderValue(node)}
                            </span>

                            <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 mr-2 shrink-0 transition-opacity">
                                <div className="relative group/tooltip">
                                    <button
                                        onClick={() => handleCopy(node.key)}
                                        className="p-1.5 hover:bg-white text-gray-400 hover:text-indigo-600 rounded-lg transition-all shadow-sm hover:shadow"
                                    >
                                        {copiedPath === node.key ? <Check className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                                    </button>
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-[10px] font-bold rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-50">
                                        Copy Key
                                    </div>
                                </div>
                                {node.type !== 'null' && (
                                    <div className="relative group/tooltip">
                                        <button
                                            onClick={() => handleCopy(typeof node.value === 'object' ? JSON.stringify(node.value, null, 2) : String(node.value))}
                                            className="p-1.5 hover:bg-white text-gray-400 hover:text-emerald-600 rounded-lg transition-all shadow-sm hover:shadow"
                                        >
                                            {copiedPath === (typeof node.value === 'object' ? JSON.stringify(node.value, null, 2) : String(node.value)) ? <Check className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                                        </button>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-[10px] font-bold rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-50">
                                            Copy Value
                                        </div>
                                    </div>
                                )}
                                <div className="relative group/tooltip">
                                    <button
                                        onClick={() => handleCopy(path)}
                                        className="p-1.5 hover:bg-white text-gray-400 hover:text-sky-600 rounded-lg transition-all shadow-sm hover:shadow"
                                    >
                                        {copiedPath === path ? <Check className="w-3.5 h-3.5" /> : <FolderTree className="w-3.5 h-3.5" />}
                                    </button>
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-[10px] font-bold rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-50">
                                        Copy Path
                                    </div>
                                </div>
                                <span className="text-[9px] font-black text-gray-300 uppercase ml-1">{node.type}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(VirtualizedJsonTree);
