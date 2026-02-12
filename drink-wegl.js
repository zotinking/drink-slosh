const glCanvas = document.getElementById("gl");
const uiCanvas = document.getElementById("ui");
const gl = glCanvas.getContext("webgl", {alpha:true});

function resize(){
  const dpr = window.devicePixelRatio || 1;
  glCanvas.width = innerWidth * dpr;
  glCanvas.height = innerHeight * dpr;
  uiCanvas.width = innerWidth * dpr;
  uiCanvas.height = innerHeight * dpr;
  gl.viewport(0,0,glCanvas.width, glCanvas.height);
}
addEventListener("resize", resize);
resize();

// ----------- 센서 입력 -----------
let gx = 0, gy = 0; // 기울기 -> 중력 방향

window.addEventListener("devicemotion", e=>{
  const g = e.accelerationIncludingGravity;
  if(!g) return;
  gx = -(g.x||0)/9.81;
  gy =  (g.y||0)/9.81;
}, true);

// ----------- 파티클 시스템 -----------
const N = 900; // 시작 입자 수 (필요시 조정)
const particles = new Float32Array(N * 4); // x,y,vx,vy

// 초기 배치 (컵 영역 대략 중앙)
for(let i=0;i<N;i++){
  const k = i*4;
  particles[k+0] = Math.random()*0.4 + 0.3; // x (0~1 정규화)
  particles[k+1] = Math.random()*0.4 + 0.4; // y
  particles[k+2] = 0;
  particles[k+3] = 0;
}

// ----------- WebGL 셰이더 (점 렌더) -----------
const vs = `
attribute vec2 aPos;
void main(){
  gl_PointSize = 6.0;
  gl_Position = vec4(aPos*2.0-1.0, 0.0, 1.0);
}`;
const fs = `
precision mediump float;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if(d > 0.5) discard;
  gl_FragColor = vec4(0.8,0.55,0.45,0.8);
}`;

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
gl.useProgram(prog);

const loc = gl.getAttribLocation(prog, "aPos");
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, 0);

// 블렌딩(겹침으로 블롭 느낌)
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

// ----------- 물리 업데이트 -----------
function step(dt){
  for(let i=0;i<N;i++){
    const k = i*4;
    let x = particles[k];
    let y = particles[k+1];
    let vx = particles[k+2];
    let vy = particles[k+3];

    // 중력(기울기)
    vx += gx * 0.4;
    vy += gy * 0.4;

    // 감쇠
    vx *= 0.98;
    vy *= 0.98;

    // 이동
    x += vx * dt;
    y += vy * dt;

    // 화면 경계 충돌(임시)
    if(x<0){x=0; vx*=-0.5;}
    if(x>1){x=1; vx*=-0.5;}
    if(y<0){y=0; vy*=-0.5;}
    if(y>1){y=1; vy*=-0.5;}

    particles[k]=x;
    particles[k+1]=y;
    particles[k+2]=vx;
    particles[k+3]=vy;
  }
}

// ----------- 렌더 루프 -----------
let last = performance.now();
function loop(now){
  const dt = Math.min(0.033, (now-last)/1000);
  last = now;

  step(dt);

  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // 위치만 GPU로 보냄
  const verts = new Float32Array(N*2);
  for(let i=0;i<N;i++){
    verts[i*2]   = particles[i*4];
    verts[i*2+1] = particles[i*4+1];
  }
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.POINTS, 0, N);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
