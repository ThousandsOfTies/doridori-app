import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiHome, FiSettings, FiHelpCircle, FiLoader, FiType, FiEdit2, FiEye, FiEyeOff } from 'react-icons/fi';
import { BiEraser, BiSelection } from 'react-icons/bi';
import { useDoriTranslation } from '../../i18n';

export type TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr';

const ERASER_SIZE_OPTIONS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

export interface BreadcrumbItem {
    label: string;
    content?: React.ReactNode;
    onClick: () => void;
    isCurrent?: boolean;
}

interface StudyToolbarProps {
    onBack?: () => void;
    onOpenSettings?: () => void;
    breadcrumbs?: BreadcrumbItem[];
    isSplitView: boolean;
    toggleSplitView: () => void;
    activeTab: 'A' | 'B';
    toggleActiveTab: () => void;
    showStudyMarkers?: boolean;
    onToggleStudyMarkers?: () => void;

    // Grading
    isSelectionMode: boolean;
    isGrading: boolean;
    startGrading: () => void;
    cancelSelection: () => void;

    // Text Tool
    isTextMode: boolean;
    toggleTextMode: () => void;
    textFontSize: number;
    setTextFontSize: (size: number) => void;
    textDirection: TextDirection;
    setTextDirection: (dir: TextDirection) => void;

    // Pen Tool
    isDrawingMode: boolean;
    toggleDrawingMode: () => void;
    penColor: string;
    setPenColor: (color: string) => void;
    penSize: number;
    setPenSize: (size: number) => void;

    // Eraser Tool
    isEraserMode: boolean;
    toggleEraserMode: () => void;
    eraserSize: number;
    setEraserSize: (size: number) => void;

    // Answer panel actions (shown when on answer panel)
    onGrade?: () => void;
    selectedModel?: string;
    setSelectedModel?: (model: string) => void;
    availableModels?: Array<{ id: string; name: string; description?: string }>;
    defaultModelName?: string;
}

export const StudyToolbar: React.FC<StudyToolbarProps> = ({
    onBack,
    onOpenSettings,
    breadcrumbs,
    isSplitView,
    toggleSplitView,
    activeTab,
    toggleActiveTab,
    showStudyMarkers = true,
    onToggleStudyMarkers,
    isSelectionMode,
    isGrading,
    startGrading,
    cancelSelection,
    isTextMode,
    toggleTextMode,
    textFontSize,
    setTextFontSize,
    textDirection,
    setTextDirection,
    isDrawingMode,
    toggleDrawingMode,
    penColor,
    setPenColor,
    penSize,
    setPenSize,
    isEraserMode,
    toggleEraserMode,
    eraserSize,
    setEraserSize,
    onGrade,
    selectedModel,
    setSelectedModel,
    availableModels,
    defaultModelName,
}) => {
    const { t } = useTranslation();
    const { t: td } = useDoriTranslation();

    // Popups visibility state
    const [showTextPopup, setShowTextPopup] = useState(false);
    const [showPenPopup, setShowPenPopup] = useState(false);
    const [showEraserPopup, setShowEraserPopup] = useState(false);
    const [showPenGuidance, setShowPenGuidance] = useState(false);
    const penGuidanceTimerRef = useRef<number | undefined>();

    useEffect(() => {
        return () => window.clearTimeout(penGuidanceTimerRef.current);
    }, []);

    // Wrappers to toggle popups and modes
    const handleTextClick = () => {
        if (isTextMode) {
            setShowTextPopup(!showTextPopup);
        } else {
            toggleTextMode();
            setShowTextPopup(false);
            setShowPenPopup(false);
            setShowEraserPopup(false);
        }
    };

    const handlePenClick = () => {
        if (isDrawingMode) {
            setShowPenPopup(!showPenPopup);
        } else {
            toggleDrawingMode();
            setShowPenPopup(false);
            setShowEraserPopup(false);
            setShowTextPopup(false);

            if (!onGrade) {
                setShowPenGuidance(true);
                window.clearTimeout(penGuidanceTimerRef.current);
                penGuidanceTimerRef.current = window.setTimeout(() => {
                    setShowPenGuidance(false);
                }, 6500);
            }
        }
    };

    const handleEraserClick = () => {
        if (isEraserMode) {
            setShowEraserPopup(!showEraserPopup);
        } else {
            toggleEraserMode();
            setShowEraserPopup(false);
            setShowPenPopup(false);
            setShowTextPopup(false);
        }
    };

    return (
        <div className="toolbar">
            {/* 戻るボタン */}
            {onBack && (
                <button onClick={onBack} title={td('toolbar.home')} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <FiHome size={20} />
                </button>
            )}

            {/* 左側の表示切替 */}
            {!onGrade && (
                <>
                    {onBack && <div className="divider" aria-hidden="true" />}
                    <div className="toolbar-view-controls">
                        <button
                            className={`tab-switcher-btn ${!isSplitView ? 'active' : ''}`}
                            onClick={toggleActiveTab}
                            title={td(isSplitView ? 'toolbar.singleView' : 'toolbar.switchPane')}
                            style={{
                                minWidth: '45px',
                            }}
                        >
                            {/* A Indicator */}
                            <span
                                style={{
                                    fontWeight: activeTab === 'A' ? 'bold' : 'normal',
                                    textDecoration: activeTab === 'A' ? 'underline' : 'none',
                                    color: activeTab === 'A' ? '#4CAF50' : 'inherit',
                                    fontSize: '0.85rem'
                                }}
                            >
                                A
                            </span>

                            <span style={{ margin: '0 4px', color: '#ccc', fontSize: '0.85rem' }}>/</span>


                            {/* B Indicator */}
                            <span
                                style={{
                                    fontWeight: activeTab === 'B' ? 'bold' : 'normal',
                                    textDecoration: activeTab === 'B' ? 'underline' : 'none',
                                    color: activeTab === 'B' ? '#4CAF50' : 'inherit',
                                    fontSize: '0.85rem'
                                }}
                            >
                                B
                            </span>
                        </button>
                        <button
                            onClick={toggleSplitView}
                            title={td(isSplitView ? 'toolbar.singleView' : 'toolbar.splitView')}
                            className={`split-view-btn ${isSplitView ? 'active' : ''}`}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="2" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                                <rect x="13" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                            </svg>
                        </button>
                    </div>
                    <div className="divider" aria-hidden="true" />
                </>
            )}

            {onBack && (
                <>
                    {onOpenSettings && <button type="button" onClick={onOpenSettings}
                        aria-label={td('reference.openSettings')} title={td('reference.openSettings')} className="book-settings-button">
                        <FiSettings size={20} />
                    </button>}

                    {/* パンくず */}
                    {breadcrumbs && breadcrumbs.length > 0 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '2px',
                            flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0,
                            scrollbarWidth: 'none', msOverflowStyle: 'none',
                            marginLeft: '0', padding: '6px 0'
                        }}>
                            {breadcrumbs.map((crumb, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <span style={{ color: '#bbb', fontSize: '13px', flexShrink: 0 }}>›</span>}
                                    <span
                                        className={crumb.content ? 'book-cover-breadcrumb' : undefined}
                                        onClick={crumb.isCurrent ? undefined : crumb.onClick}
                                        style={{
                                            fontSize: '13px',
                                            color: crumb.isCurrent ? '#333' : '#2c7be5',
                                            fontWeight: crumb.isCurrent ? 600 : 400,
                                            cursor: crumb.isCurrent ? 'default' : 'pointer',
                                            padding: crumb.content ? '0 6px' : '3px 6px',
                                            borderRadius: '10px',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {crumb.content ?? crumb.label}
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                </>
            )}



            {/* 右寄せコンテナ */}
            <div className="toolbar-tools">

                <>
                    {onToggleStudyMarkers && (
                        <button
                            type="button"
                            className={`study-trace-visibility-button${showStudyMarkers ? ' active' : ''}`}
                            onClick={onToggleStudyMarkers}
                            aria-label={td('toolbar.showMarkers')}
                            aria-pressed={showStudyMarkers}
                            title={td(showStudyMarkers ? 'toolbar.markersOn' : 'toolbar.markersOff')}
                        >
                            {showStudyMarkers ? <FiEye size={20} /> : <FiEyeOff size={20} />}
                        </button>
                    )}
                    <div className="divider"></div>

                    {/* 描画ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handlePenClick}
                            className={isDrawingMode ? 'active' : ''}
                            title={td(isDrawingMode ? 'toolbar.penOn' : 'toolbar.penOff')}
                        >
                            <FiEdit2 size={20} color={isDrawingMode ? penColor : 'currentColor'} />
                        </button>

                        {/* ペン設定ポップアップ */}
                        {isDrawingMode && showPenPopup && (
                            <div className="tool-popup">
                                <div className="popup-row">
                                    <label>{td('toolbar.color')}</label>
                                    <input
                                        type="color"
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        className="color-swatch-input"
                                    />
                                </div>
                                <div className="popup-row">
                                    <label>{td('toolbar.width')}</label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="10"
                                        step="1"
                                        value={penSize}
                                        onChange={(e) => setPenSize(Number(e.target.value))}
                                        style={{ width: '100px' }}
                                    />
                                    <span>{penSize}px</span>
                                </div>
                            </div>
                        )}

                        {showPenGuidance && (
                            <div className="pen-guidance" role="status">
                                {td('toolbar.penHint')}
                            </div>
                        )}
                    </div>

                    {/* 消しゴムツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handleEraserClick}
                            className={isEraserMode ? 'active' : ''}
                            title={td(isEraserMode ? 'toolbar.eraserOn' : 'toolbar.eraserOff')}
                        >
                            <BiEraser size={20} className="icon-scale-13" />
                        </button>

                        {/* 消しゴム設定ポップアップ */}
                        {isEraserMode && showEraserPopup && (
                            <div className="tool-popup">
                                <div className="popup-row">
                                    <label>{td('toolbar.size')}</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max={ERASER_SIZE_OPTIONS.length - 1}
                                        step="1"
                                        value={Math.max(0, ERASER_SIZE_OPTIONS.indexOf(eraserSize as typeof ERASER_SIZE_OPTIONS[number]))}
                                        onChange={(e) => setEraserSize(ERASER_SIZE_OPTIONS[Number(e.target.value)])}
                                        style={{ width: '100px' }}
                                        aria-valuetext={`${eraserSize}px`}
                                    />
                                    <span>{eraserSize}px</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* テキスト入力ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handleTextClick}
                            className={isTextMode ? 'active' : ''}
                            title={td(isTextMode ? 'toolbar.textOn' : 'toolbar.textOff')}
                        >
                            <FiType size={20} />
                        </button>

                        {/* テキスト設定ポップアップ */}
                        {isTextMode && showTextPopup && (
                            <div className="tool-popup" style={{ minWidth: '180px' }}>
                                <div className="popup-row">
                                    <label>{td('toolbar.size')}</label>
                                    <input
                                        type="range"
                                        min="10"
                                        max="32"
                                        value={textFontSize}
                                        onChange={(e) => setTextFontSize(Number(e.target.value))}
                                        style={{ width: '80px' }}
                                    />
                                    <span>{textFontSize}px</span>
                                </div>
                                <div className="popup-row">
                                    <label>{td('toolbar.direction')}</label>
                                    <select
                                        value={textDirection}
                                        onChange={(e) => setTextDirection(e.target.value as TextDirection)}
                                        style={{ padding: '4px', borderRadius: '4px' }}
                                    >
                                        <option value="horizontal">{td('toolbar.horizontal')}</option>
                                        <option value="vertical-rl">{td('toolbar.verticalRL')}</option>
                                        <option value="vertical-lr">{td('toolbar.verticalLR')}</option>
                                    </select>
                                </div>
                                <div className="popup-row">
                                    <label>{td('toolbar.color')}</label>
                                    <input
                                        type="color"
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        className="color-swatch-input"
                                    />
                                </div>
                            </div>
                        )}
                    </div>


                    {/* Context-specific buttons */}
                    {onGrade ? (
                        /* Answer panel mode */
                        <>
                            <div className="divider"></div>
                            {setSelectedModel && availableModels && (
                                <select
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                >
                                    <option value="default">{defaultModelName}</option>
                                    {availableModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            )}
                            <button
                                onClick={onGrade}
                                disabled={isGrading}
                                className="btn-submit"
                                title={td('toolbar.ask')}
                                aria-label={td('toolbar.ask')}
                                style={{
                                    cursor: isGrading ? 'wait' : 'pointer',
                                    opacity: isGrading ? 0.6 : 1,
                                    transition: 'all 0.15s',
                                }}
                            >
                                {isGrading ? <FiLoader size={20} className="animate-spin" /> : <FiHelpCircle size={20} />}
                            </button>
                        </>
                    ) : (
                        /* PDF mode: range selection button */
                        <>
                            <div className="divider"></div>
                            <button
                                onClick={isSelectionMode ? cancelSelection : startGrading}
                                className={isSelectionMode ? 'active' : ''}
                                disabled={isGrading}
                                title={isSelectionMode ? t('gradingConfirmation.cancel') : td('toolbar.select')}
                            >
                                {isGrading ? <FiLoader size={20} className="animate-spin" /> : <BiSelection size={20} className="icon-scale-13" />}
                            </button>
                        </>
                    )}
                </>
            </div>
        </div>
    );
};
