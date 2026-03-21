import React from 'react';
import './Legal.css';

interface AboutProps {
    onClose: () => void;
}

const About: React.FC<AboutProps> = ({ onClose }) => {
    return (
        <div className="legal-modal-overlay" onClick={onClose}>
            <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
                <div className="legal-modal-header">
                    <h2>🦉 DoriDoriについて</h2>
                    <button className="legal-modal-close" onClick={onClose} title="閉じる">
                        ✕
                    </button>
                </div>

                <div className="legal-modal-content">
                    <h3>DoriDoriとは</h3>
                    <p>
                        DoriDoriでは、お子様のSNSの利用の前に「本アプリでの学習」という制限を設けることが可能になります。
                        お勉強に用いる教材はPDFファイルで登録します。
                        PDFファイルに直接書き込みを行い、採点はAIが行います。
                    </p>

                    <h3>主な機能</h3>
                    <ul>
                        <li><strong>PDF教材の管理</strong> - 学習用のPDFファイルをアプリに登録して管理できます</li>
                        <li><strong>手書き編集</strong> - タッチペンや指で直接PDFを編集することができます</li>
                        <li><strong>AI自動採点</strong> - Google Gemini AIを使用して自動採点します</li>
                        <li><strong>SNSアクセス</strong> - 採点後に時間制限を設けたSNSへのアクセス許可を与えることが可能です</li>
                        <li><strong>学習履歴</strong> - 採点結果の履歴を確認できます</li>
                    </ul>

                    <h3>対応デバイス</h3>
                    <p>以下のデバイス・ブラウザでご利用いただけます：</p>
                    <ul>
                        <li>iPad / iPhone（Safari）- Apple Pencil対応</li>
                        <li>Windows PC（Chrome, Edge）</li>
                        <li>Mac PC（Safari）- 未確認</li>
                        <li>Android タブレット / スマートフォン（Chrome）- 未確認</li>
                    </ul>

                    <h3>開発・運営</h3>
                    <div style={{
                        backgroundColor: '#f8f9fa',
                        padding: '16px',
                        borderRadius: '8px',
                        margin: '16px 0'
                    }}>
                        <p style={{ margin: '0 0 8px 0' }}>
                            <strong>運営者:</strong> ThousandsOfTies
                        </p>
                        <p style={{ margin: '0 0 8px 0' }}>
                            <strong>メール:</strong>{' '}
                            <a href="mailto:thousands.of.ties@gmail.com" style={{ color: '#3498db' }}>
                                thousands.of.ties@gmail.com
                            </a>
                        </p>
                        <p style={{ margin: 0 }}>
                            <strong>GitHub:</strong>{' '}
                            <a
                                href="https://github.com/ThousandsOfTies"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#3498db' }}
                            >
                                github.com/ThousandsOfTies
                            </a>
                        </p>
                    </div>

                    <h3>バージョン情報</h3>
                    <p>
                        <strong>現在のバージョン:</strong> 0.2.1
                    </p>
                    <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5', borderRadius: '4px', fontSize: '0.8rem' }}>
                        <p><strong>Debug Info:</strong></p>
                        <p style={{ wordBreak: 'break-all' }}>URL: {window.location.href}</p>
                        <p>Premium: {localStorage.getItem('userSettings') && JSON.parse(localStorage.getItem('userSettings') || '{}').isPremium ? 'YES' : 'NO'}</p>
                    </div>

                    <h3>謝辞</h3>
                    <p>
                        DoriDoriは以下の技術・サービスを使用しています：
                    </p>
                    <ul>
                        <li>React - UIフレームワーク</li>
                        <li>Vite - ビルドツール</li>
                        <li>PDF.js - PDF表示ライブラリ</li>
                        <li>Google Gemini AI - 自動採点エンジン</li>
                    </ul>

                    <h3>⚠️ 免責事項</h3>
                    <div style={{
                        backgroundColor: '#fff3cd',
                        border: '1px solid #ffc107',
                        padding: '16px',
                        borderRadius: '8px',
                        margin: '16px 0'
                    }}>
                        <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#856404' }}>
                            AI自動採点について
                        </p>
                        <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', color: '#856404' }}>
                            本アプリのAI自動採点機能は、Google Gemini AIを使用していますが、
                            <strong>採点結果が必ずしも正確であるとは限りません</strong>。
                            AIによる判定には誤りが含まれる可能性があるため、
                            保護者の方は必ずお子様の解答を確認し、最終的な正誤判定を行ってください。
                            本機能はあくまで学習のサポートツールとしてご利用ください。
                        </p>
                    </div>
                </div>

                <div className="legal-modal-footer">
                    <button onClick={onClose}>閉じる</button>
                </div>
            </div>
        </div>
    );
};

export default About;
