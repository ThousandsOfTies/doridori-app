// アイコンSVGの定義
export const ICON_SVG = {
  // ペンアイコン（ボタン用）
  pen: (isActive: boolean, color: string) => (
    <svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24'>
      <path fill={color} d='M3,17.25V21h3.75L17.81,9.94l-3.75-3.75L3,17.25z M20.71,7.04c0.39-0.39,0.39-1.02,0-1.41l-2.34-2.34 c-0.39-0.39-1.02-0.39-1.41,0l-1.83,1.83l3.75,3.75L20.71,7.04z' />
    </svg>
  ),
  // 消しゴムアイコン（ボタン用）
  eraser: (isActive: boolean) => (
    <svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24'>
      <rect fill='#2196F3' x='5' y='3' width='14' height='14' rx='1' />
      <rect fill='white' stroke='#666' strokeWidth='1' x='6' y='17' width='12' height='4' rx='0.5' />
      <line stroke='#1976D2' strokeWidth='0.5' x1='7' y1='10' x2='17' y2='10' />
    </svg>
  ),
  // ペンカーソル（Data URL用）
  penCursor: (color: string) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'></path></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 22, crosshair`
  },
  // 消しゴムカーソル（Data URL用）
  eraserCursor: (() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='#2196F3'><path d='m20.669 9.38-6.049-6.05A1.99 1.99 0 0 0 13.206 2.75L2.75 13.206c-.4.4-.622.95-.625 1.515a2.13 2.13 0 0 0 .62 1.515l3.205 3.205A2.13 2.13 0 0 0 7.465 20.06h14.41c.552 0 1-.448 1-1s-.448-1-1-1h-6.215l6.05-6.049a2 2 0 0 0 .041-2.822zM7.465 18.06l-3.3-3.3 5.48-5.48 3.3 3.3-5.48 5.48zm1.41-8.38 3.3 3.3 4.1-4.09-3.3-3.3-4.1 4.09z'></path></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 14, crosshair`
  })(),
  // 範囲選択アイコン
  selection: (isActive: boolean) => (
    <svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'>
      <rect x='3.5' y='3.5' width='17' height='17' rx='1' stroke='currentColor' strokeWidth='1.5' strokeDasharray='3 2'/>
      <rect x='1' y='1' width='5' height='5' rx='1' fill={isActive ? '#2196F3' : 'currentColor'}/>
      <rect x='18' y='1' width='5' height='5' rx='1' fill={isActive ? '#2196F3' : 'currentColor'}/>
      <rect x='1' y='18' width='5' height='5' rx='1' fill={isActive ? '#2196F3' : 'currentColor'}/>
      <rect x='18' y='18' width='5' height='5' rx='1' fill={isActive ? '#2196F3' : 'currentColor'}/>
    </svg>
  ),
} as const
