import React from 'react';
import './Legal.css';

interface ContactProps {
    onClose: () => void;
}

const Contact: React.FC<ContactProps> = ({ onClose }) => {
    return (
        <div className="legal-modal-overlay" onClick={onClose}>
            <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
                <div className="legal-modal-header">
                    <h2>📧 お問い合わせ</h2>
                    <button className="legal-modal-close" onClick={onClose} title="閉じる">
                        ✕
                    </button>
                </div>

                <div className="legal-modal-content">
                    <h3>お問い合わせ先</h3>
                    <p>
                        DoriDoriに関するご質問、ご意見、ご要望、不具合のご報告などは、
                        下記のメールアドレスまでお気軽にお問い合わせください。
                    </p>

                    <div style={{
                        backgroundColor: '#f8f9fa',
                        padding: '20px',
                        borderRadius: '8px',
                        textAlign: 'center',
                        margin: '20px 0'
                    }}>
                        <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#7f8c8d' }}>
                            メールアドレス
                        </p>
                        <a
                            href="mailto:thousands.of.ties@gmail.com"
                            style={{
                                fontSize: '18px',
                                fontWeight: '600',
                                color: '#3498db',
                                textDecoration: 'none'
                            }}
                        >
                            thousands.of.ties@gmail.com
                        </a>
                    </div>

                    <h3>お問い合わせの際のお願い</h3>
                    <ul>
                        <li>お問い合わせの内容によっては、回答にお時間をいただく場合があります</li>
                        <li>不具合のご報告の際は、使用しているデバイス・ブラウザの情報もお知らせください</li>
                        <li>お問い合わせへの回答は、原則としてメールにて行います</li>
                    </ul>

                    <h3>よくあるご質問</h3>

                    <p><strong>Q: データはどこに保存されますか？</strong></p>
                    <p>
                        A: すべてのデータはお使いのデバイス内（ブラウザのIndexedDB）に保存されます。
                        外部サーバーには送信されません。
                    </p>

                    <p><strong>Q: 複数のデバイスでデータを共有できますか？</strong></p>
                    <p>
                        A: 現在、デバイス間でのデータ同期機能はありません。
                        各デバイスで個別にデータが保存されます。
                    </p>

                    <p><strong>Q: データを削除するにはどうすればいいですか？</strong></p>
                    <p>
                        A: アプリ内のAdmin画面にある「Storage」から「すべて削除」を選択すると、
                        保存されているすべてのデータを削除できます。
                    </p>
                </div>

                <div className="legal-modal-footer">
                    <button onClick={onClose}>閉じる</button>
                </div>
            </div>
        </div>
    );
};

export default Contact;
