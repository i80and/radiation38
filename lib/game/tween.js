ig.module(
    'game.tween'
)
.defines(function() {
'use strict'

function lerp(A, B, t) {
    return A + t * (B - A)
}

class InterpolationValue {
    constructor(value, rate) {
        this.startValue = value
        this.curValue = value
        this.targetValue = value
        this.rate = rate

        this._startTime = null
        this._finishTime = null
    }

    teleport(x) {
        this.startValue = x
        this.curValue = x
        this.targetValue = x
    }

    add(x) {
        this.lerpTo(this.targetValue + x)
    }

    update() {
        if (this.curValue === this.targetValue || this._finishTime === this._startTime) {
            return 0
        }

        const curTime = Math.min(performance.now(), this._finishTime)
        const t = (curTime - this._startTime) / (this._finishTime - this._startTime)
        const oldValue = this.curValue
        this.curValue = lerp(this.startValue, this.targetValue, t)
        return this.curValue - oldValue
    }

    isDone() {
        return this.curValue === this.targetValue
    }

    lerpTo(targetValue) {
        this.startValue = this.curValue
        this.targetValue = targetValue

        const delta = Math.abs(this.targetValue - this.startValue)
        this._startTime = performance.now()
        this._finishTime = this._startTime + (delta / this.rate) * 1000
    }
}

window.InterpolationValue = InterpolationValue

})
