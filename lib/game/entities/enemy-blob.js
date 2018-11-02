ig.module(
	'game.entities.enemy-blob'
)
.requires(
	'plugins.twopointfive.entity',
	'game.entities.particle',
	'game.tween',
	'game.state'
)
.defines(function(){

const SCALE = 64;

EntityEnemyBlob = tpf.Entity.extend({
	type: ig.Entity.TYPE.B,
	checkAgainst: ig.Entity.TYPE.A,
	collides: ig.Entity.COLLIDES.ACTIVE,

	size: {x: 16, y: 16},
	friction: {x: 100, y: 100},
	scale: 1.0,
	tilePos: [null, null],
	moveSpeed: 1,

	health: 10,
	damage: 10,

	_wmBoxColor: '#ff0000',

	angle: 0,
	speed: 80,
	injump: false,

	didHurtPlayer: false,
	seenPlayer: false,


	animSheet: new ig.AnimationSheet( 'media/supermutant.png', 64, 64 ),

	init: function( x, y, settings ) {
		this.parent( x * SCALE, y * SCALE, settings );
		var crawFrameTime = 0.04 + Math.random() * 0.02;

		this.addAnim( 'crawl', 0.04, [0] );
		this.currentAnim.gotoRandomFrame();

		this.tilePos = [
			new InterpolationValue(x, this.moveSpeed),
			new InterpolationValue(y, this.moveSpeed)
		];
	},


	update: function() {
		if (!this.tilePos[0].isDone() || !this.tilePos[1].isDone()) {
			this.vel.x = this.tilePos[0].update() * SCALE * SCALE;
			this.vel.y = this.tilePos[1].update() * SCALE * SCALE;
		} else {
			this.vel.x = 0;
			this.vel.y = 0;
		}

		this.parent();
	},

	moveTo: function(x, y) {
		this.tilePos[0].lerpTo(x);
		this.tilePos[1].lerpTo(y);
	},

	kill: function() {
		var cx = this.pos.x + this.size.x/2;
		var cy = this.pos.y + this.size.y/2;
		for( var i = 0; i < 20; i++ ) {
			ig.game.spawnEntity( EntityEnemyBlobGib, cx, cy );
		}
		ig.game.blobKillCount++;
		this.parent();
	},

	check: function( other ) {
		this.vel.x = -this.vel.x;
		this.vel.y = -this.vel.y;
		other.receiveDamage( this.damage, this );
	}
});



EntityEnemyBlobGib = EntityParticle.extend({
	vpos: 0,
	scale: 0.5,
	initialVel: {x:120, y: 120, z: 2.5},
	friction: {x: 10, y: 10},

	lifetime: 2,

	animSheet: new ig.AnimationSheet( 'media/blob-gib.png', 16, 16 ),

	init: function( x, y, settings ) {
		this.addAnim( 'idle', 5, [0,1,2,3,4,5,6,7,8,9,10,11] );
		this.parent( x, y, settings );
	}
});


});
