// One continuous phase keeps the two wings synchronized at every frame rate.
// The power stroke is quicker than the recovery; tips trail the shoulder.
const TAU=Math.PI*2;
export function wingbeatPose(phase,climb=0,speed=35){
 const p=((phase%TAU)+TAU)%TAU/TAU;
 const down=p<.42;
 const t=down?p/.42:(p-.42)/.58;
 const ease=(1-Math.cos(t*Math.PI))*.5;
 const strength=climb>=0?.77+climb*.2:.77+climb*.43;
 const sweep=(down?1-2*ease:-1+2*ease)*strength;
 const recovery=down?0:Math.sin(t*Math.PI);
 return {sweep,fold:recovery*.18,tip:Math.sin(phase-.62)*strength*.23,body:Math.sin(phase-.4)*.13,frequency:.77+Math.max(0,climb)*.3+Math.max(0,35-speed)*.003};
}
