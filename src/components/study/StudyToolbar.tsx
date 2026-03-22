import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SVG } from '../../constants/icons';
import { FiHome, FiRotateCcw, FiTrash2, FiCheckCircle, FiLoader, FiType, FiEdit2 } from 'react-icons/fi';
import { BiEraser, BiSelection } from 'react-icons/bi';

export type TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr';

export interface BreadcrumbItem {
    label: string;
    onClick: () => void;
    isCurrent?: boolean;
}

interface StudyToolbarProps {
    onBack?: () => void;
    breadcrumbs?: BreadcrumbItem[];
    isSplitView: boolean;
    toggleSplitView: () => void;
    activeTab: 'A' | 'B';
    toggleActiveTab: () => void;

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

    // Actions
    onUndo: () => void;
    onClear: () => void;
    onClearAll: () => void;

    // Answer panel actions (shown when on answer panel)
    onGrade?: () => void;
    canUndoAnswer?: boolean;
    onUndoAnswer?: () => void;
    onClearAnswer?: () => void;
    selectedModel?: string;
    setSelectedModel?: (model: string) => void;
    availableModels?: Array<{ id: string; name: string; description?: string }>;
    defaultModelName?: string;
}

export const StudyToolbar: React.FC<StudyToolbarProps> = ({
    onBack,
    breadcrumbs,
    isSplitView,
    toggleSplitView,
    activeTab,
    toggleActiveTab,
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
    onUndo,
    onClear,
    onClearAll,
    onGrade,
    canUndoAnswer,
    onUndoAnswer,
    onClearAnswer,
    selectedModel,
    setSelectedModel,
    availableModels,
    defaultModelName,
}) => {
    const { t } = useTranslation();

    // Popups visibility state
    const [showTextPopup, setShowTextPopup] = useState(false);
    const [showPenPopup, setShowPenPopup] = useState(false);
    const [showEraserPopup, setShowEraserPopup] = useState(false);

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
                <>
                    <button onClick={onBack} title="ホームに戻る" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <FiHome size={20} />
                    </button>

                    {/* パンくず (ホームの横へ移動) */}
                    {breadcrumbs && breadcrumbs.length > 0 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '2px',
                            flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0,
                            scrollbarWidth: 'none', msOverflowStyle: 'none',
                            marginLeft: '8px'
                        }}>
                            {breadcrumbs.map((crumb, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <span style={{ color: '#bbb', fontSize: '13px', flexShrink: 0 }}>›</span>}
                                    <span
                                        onClick={crumb.isCurrent ? undefined : crumb.onClick}
                                        style={{
                                            fontSize: '13px',
                                            color: crumb.isCurrent ? '#333' : '#2c7be5',
                                            fontWeight: crumb.isCurrent ? 600 : 400,
                                            cursor: crumb.isCurrent ? 'default' : 'pointer',
                                            padding: '3px 6px',
                                            borderRadius: '10px',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {crumb.label}
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                    )}




                </>
            )}



            {/* 右寄せコンテナ */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>

                <>
                    <div className="divider"></div>

                    {/* 描画ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handlePenClick}
                            className={isDrawingMode ? 'active' : ''}
                            title={isDrawingMode ? 'ペンモード ON（クリックで設定）' : 'ペンモード OFF'}
                        >
                            <FiEdit2 size={20} color={isDrawingMode ? penColor : 'currentColor'} />
                        </button>

                        {/* ペン設定ポップアップ */}
                        {isDrawingMode && showPenPopup && (
                            <div className="tool-popup">
                                <div className="popup-row">
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        style={{ width: '40px', height: '30px', border: '1px solid #ccc', cursor: 'pointer' }}
                                    />
                                </div>
                                <div className="popup-row">
                                    <label>太さ:</label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="10"
                                        value={penSize}
                                        onChange={(e) => setPenSize(Number(e.target.value))}
                                        style={{ width: '100px' }}
                                    />
                                    <span>{penSize}px</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 消しゴムツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handleEraserClick}
                            className={isEraserMode ? 'active' : ''}
                            title={isEraserMode ? '消しゴムモード ON（クリックで設定）' : '消しゴムモード OFF'}
                        >
                            <BiEraser size={20} className="icon-scale-13" />
                        </button>

                        {/* 消しゴム設定ポップアップ */}
                        {isEraserMode && showEraserPopup && (
                            <div className="tool-popup">
                                <div className="popup-row">
                                    <label>サイズ:</label>
                                    <input
                                        type="range"
                                        min="10"
                                        max="100"
                                        value={eraserSize}
                                        onChange={(e) => setEraserSize(Number(e.target.value))}
                                        style={{ width: '100px' }}
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
                            title={isTextMode ? 'テキストモード ON（クリックで設定）' : 'テキストモード OFF'}
                        >
                            <FiType size={20} />
                        </button>

                        {/* テキスト設定ポップアップ */}
                        {isTextMode && showTextPopup && (
                            <div className="tool-popup" style={{ minWidth: '180px' }}>
                                <div className="popup-row">
                                    <label>サイズ:</label>
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
                                    <label>方向:</label>
                                    <select
                                        value={textDirection}
                                        onChange={(e) => setTextDirection(e.target.value as TextDirection)}
                                        style={{ padding: '4px', borderRadius: '4px' }}
                                    >
                                        <option value="horizontal">横書き (Z型)</option>
                                        <option value="vertical-rl">縦書き右始 (N型)</option>
                                        <option value="vertical-lr">縦書き左始</option>
                                    </select>
                                </div>
                                <div className="popup-row">
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        style={{ width: '40px', height: '30px', border: '1px solid #ccc', cursor: 'pointer' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {!onGrade && (
                        <>
                            <div className="divider" style={{ margin: '0 4px' }}></div>

                            {/* Split View Toggle (Moved to Tool Group) */}
                            <button
                                onClick={toggleSplitView}
                                title={isSplitView ? 'シングルビューに戻す' : '2画面表示 (Split View)'}
                                className={isSplitView ? 'active' : ''}
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="2" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                                    <rect x="13" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                                </svg>
                            </button>

                            {/* Tab Switcher Button (Widened) */}
                            <button
                                className={`tab-switcher-btn ${!isSplitView ? 'active' : ''}`}
                                onClick={toggleActiveTab}
                                title={isSplitView ? "シングルビューへ切替" : "A/B 切替"}
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
                        </>
                    )}

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
                                title="採点する"
                                style={{
                                    cursor: isGrading ? 'wait' : 'pointer',
                                    opacity: isGrading ? 0.6 : 1,
                                    transition: 'all 0.15s',
                                }}
                            >
                                {isGrading ? <FiLoader size={20} className="animate-spin" /> : <FiCheckCircle size={20} />}
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
                                title={isSelectionMode ? t('gradingConfirmation.cancel') : t('gradingConfirmation.gradeBySelection')}
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
