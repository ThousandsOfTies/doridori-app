function getPerspectiveTransform(src, dst) {
    const a = [
        [src[0], src[1], 1, 0, 0, 0, -src[0] * dst[0], -src[1] * dst[0]],
        [0, 0, 0, src[0], src[1], 1, -src[0] * dst[1], -src[1] * dst[1]],
        [src[2], src[3], 1, 0, 0, 0, -src[2] * dst[2], -src[3] * dst[2]],
        [0, 0, 0, src[2], src[3], 1, -src[2] * dst[3], -src[3] * dst[3]],
        [src[4], src[5], 1, 0, 0, 0, -src[4] * dst[4], -src[5] * dst[4]],
        [0, 0, 0, src[4], src[5], 1, -src[4] * dst[5], -src[5] * dst[5]],
        [src[6], src[7], 1, 0, 0, 0, -src[6] * dst[6], -src[7] * dst[6]],
        [0, 0, 0, src[6], src[7], 1, -src[6] * dst[7], -src[7] * dst[7]]
    ];
    const b = [dst[0], dst[1], dst[2], dst[3], dst[4], dst[5], dst[6], dst[7]];

    // Gaussian elimination
    for (let i = 0; i < 8; i++) {
        let maxRow = i;
        for (let j = i + 1; j < 8; j++) {
            if (Math.abs(a[j][i]) > Math.abs(a[maxRow][i])) {
                maxRow = j;
            }
        }

        // Swap rows
        const tmpA = a[i]; a[i] = a[maxRow]; a[maxRow] = tmpA;
        const tmpB = b[i]; b[i] = b[maxRow]; b[maxRow] = tmpB;

        for (let j = i + 1; j < 8; j++) {
            const factor = a[j][i] / a[i][i];
            for (let k = i; k < 8; k++) {
                a[j][k] -= a[i][k] * factor;
            }
            b[j] -= b[i] * factor;
        }
    }

    const x = new Array(8).fill(0);
    for (let i = 7; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < 8; j++) {
            sum += a[i][j] * x[j];
        }
        x[i] = (b[i] - sum) / a[i][i];
    }

    return [...x, 1];
}

const dstWidth = 1000;
const dstHeight = 1000;
const dst = [0, 0, dstWidth, 0, dstWidth, dstHeight, 0, dstHeight];
const src = [200, 200, 800, 100, 900, 700, 100, 900];

const T = getPerspectiveTransform(dst, src);
console.log("Transform:", T);

// verify
for (let i = 0; i < 4; i++) {
    const x = dst[i * 2];
    const y = dst[i * 2 + 1];
    const w = T[6] * x + T[7] * y + T[8];
    const sx = (T[0] * x + T[1] * y + T[2]) / w;
    const sy = (T[3] * x + T[4] * y + T[5]) / w;
    console.log(`Dst(${x},${y}) -> Src(${sx},${sy}) vs Expected(${src[i * 2]},${src[i * 2 + 1]})`);
}
