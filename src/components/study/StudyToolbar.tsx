import { StudyToolbarNavigation, type BreadcrumbItem } from '@home-teacher/common/components/study/StudyToolbarNavigation'
import { StudyEraserTool, StudyTextTool, type TextDirection } from '@home-teacher/common/components/study/StudyToolSettings'
import { useStudyToolPopups } from '@home-teacher/common/hooks/useStudyToolPopups'
export type { BreadcrumbItem } from '@home-teacher/common/components/study/StudyToolbarNavigation'
export type { TextDirection } from '@home-teacher/common/components/study/StudyToolSettings'
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiSettings, FiHelpCircle, FiLoader, FiEdit2, FiEye, FiEyeOff } from 'react-icons/fi';
import { BiSelection } from 'react-icons/bi';
import { useDoriTranslation } from '../../i18n';

interface StudyToolbarProps {
    onBack?: () => void;
    onOpenSettings?: () => void;
    breadcrumbs?: BreadcrumbItem[];
    pageViewControlsEnabled: boolean;
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
    pageViewControlsEnabled,
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
    const [showPenGuidance, setShowPenGuidance] = useState(false);
    const penGuidanceTimerRef = useRef<number | undefined>();

    useEffect(() => {
        return () => window.clearTimeout(penGuidanceTimerRef.current);
    }, []);

    const {
        showTextPopup, showPenPopup, showEraserPopup,
        handleTextClick, handlePenClick, handleEraserClick,
    } = useStudyToolPopups({
        text: { active: isTextMode, toggle: toggleTextMode },
        pen: {
            active: isDrawingMode,
            toggle: () => {
                toggleDrawingMode();
                if (!onGrade) {
                    setShowPenGuidance(true);
                    window.clearTimeout(penGuidanceTimerRef.current);
                    penGuidanceTimerRef.current = window.setTimeout(() => {
                        setShowPenGuidance(false);
                    }, 6500);
                }
            },
        },
        eraser: { active: isEraserMode, toggle: toggleEraserMode },
    });

    return (
        <div className="toolbar">
            <StudyToolbarNavigation
                onBack={onBack}
                breadcrumbs={breadcrumbs}
                pageViewControlsEnabled={pageViewControlsEnabled}
                isSplitView={isSplitView}
                toggleSplitView={toggleSplitView}
                activeTab={activeTab}
                toggleActiveTab={toggleActiveTab}
                labels={{
                    home: td('toolbar.home'),
                    switchPane: td(isSplitView ? 'toolbar.singleView' : 'toolbar.switchPane'),
                    splitView: td(isSplitView ? 'toolbar.singleView' : 'toolbar.splitView'),
                }}
                breadcrumbStyle={{ padding: '6px 0' }}
                contentBreadcrumbClassName="book-cover-breadcrumb"
                beforeBreadcrumbs={onOpenSettings && <button type="button" onClick={onOpenSettings}
                    aria-label={td('reference.openSettings')} title={td('reference.openSettings')} className="book-settings-button">
                    <FiSettings size={20} />
                </button>}
            />

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

                    <StudyEraserTool
                        active={isEraserMode}
                        popupVisible={showEraserPopup}
                        onClick={handleEraserClick}
                        title={td(isEraserMode ? 'toolbar.eraserOn' : 'toolbar.eraserOff')}
                        size={eraserSize}
                        setSize={setEraserSize}
                        sizeLabel={td('toolbar.size')}
                    />
                    <StudyTextTool
                        active={isTextMode}
                        popupVisible={showTextPopup}
                        onClick={handleTextClick}
                        title={td(isTextMode ? 'toolbar.textOn' : 'toolbar.textOff')}
                        fontSize={textFontSize}
                        setFontSize={setTextFontSize}
                        direction={textDirection}
                        setDirection={setTextDirection}
                        color={penColor}
                        setColor={setPenColor}
                        labels={{
                            size: td('toolbar.size'), direction: td('toolbar.direction'),
                            horizontal: td('toolbar.horizontal'),
                            verticalRight: td('toolbar.verticalRL'), verticalLeft: td('toolbar.verticalLR'),
                            color: td('toolbar.color'),
                        }}
                        colorInputClassName="color-swatch-input"
                    />

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
