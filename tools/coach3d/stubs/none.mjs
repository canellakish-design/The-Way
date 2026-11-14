// Parts of three.js the talking-avatar library imports but the coach never uses (FBX animations, Draco, the stats
// panel): left out of the bundle.
export class FBXLoader { load(){ throw new Error('FBX is not in this build'); } }
export class DRACOLoader { setDecoderPath(){} }
export default class Stats { constructor(){ this.dom = document.createElement('div'); } update(){} }
