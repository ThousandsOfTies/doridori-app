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
        const tmpA = a[i]; a[i] = a[maxRow]; a[maxRow] = tmpA;
        const tmpB = b[i]; b[i] = b[maxRow]; b[maxRow] = tmpB;

        if (Math.abs(a[i][i]) < 1e-10) {
            console.error("Matrix is singular");
            return null;
        }

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

const dstCorners = [0, 0, 100, 0, 100, 100, 0, 100];
const srcCorners = [10, 10, 90, 10, 80, 80, 10, 90];
const transform = getPerspectiveTransform(dstCorners, srcCorners);
console.log(transform);
