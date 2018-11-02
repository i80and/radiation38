ig.module(
	'game.entities.player'
)
.requires(
	'plugins.twopointfive.entity',
	'plugins.mouse-delta',
	'game.weapons.grenade-launcher',
	'game.tween'
)
.defines(function() {

const SCALE = 64;

EntityPlayer = tpf.Entity.extend({
	type: ig.Entity.TYPE.A,
	collides: ig.Entity.COLLIDES.PASSIVE,

	isSpawned: false,
	tilePos: [null, null],
	pendingMove: false,

	angle: null,

	size: {x: 32, y: 32},

	turnSpeed: (120).toRad(),
	moveSpeed: 1,
	bob: 0,
	bobSpeed: 0.1,
	bobHeight: 0.8,

	health: 100,
	maxHealth: 100,

	weapons: [],

	currentWeapon: null,
	currentWeaponIndex: -1,
	delayedWeaponSwitchIndex: -1,

	currentLightColor: {r:1, g:1, b:1, a:1},

	god: false,

	hurtSounds: [
		new ig.Sound('media/sounds/hurt1.*'),
		new ig.Sound('media/sounds/hurt2.*'),
		new ig.Sound('media/sounds/hurt3.*')
	],

	init: function( x, y, settings ) {
		this.parent( x, y, settings );
		ig.game.player = this;
		this.angle = new InterpolationValue(0, this.turnSpeed);
		this.tilePos = [
			new InterpolationValue(0, this.moveSpeed),
			new InterpolationValue(0, this.moveSpeed)
		];

		window.setPosition = (x, y) => {
			this.pos.x = x;
			this.pos.y = y;
		}
		window.player = this
	},

	ready: function() {
		var cx = this.pos.x + this.size.x/2,
			cy = this.pos.y + this.size.y/2;
		ig.system.camera.position[0] = cx;
		ig.system.camera.position[2] = cy;

		window.stitchClient.callFunction('spawn').then((data) => {
			this.tilePos[0].teleport(data.pos[0]);
			this.tilePos[1].teleport(data.pos[1]);
			this.pos.x = (data.pos[0] * SCALE);
			this.pos.y = (data.pos[1] * SCALE);
			this.isSpawned = true;
		}).catch((err) => {
			console.error(err);
		});

		this.giveWeapon( WeaponGrenadeLauncher, 16 );
	},

	moveTo: function(x, y) {
		this.tilePos[0].lerpTo(x);
		this.tilePos[1].lerpTo(y)
		this.pendingMove = false;
	},

	update: function() {
		if (!this.isSpawned) { return; }

		if (!this.angle.isDone()) {
			this.angle.update();
		} else if (!this.tilePos[0].isDone() || !this.tilePos[1].isDone()) {
			this.vel.x = this.tilePos[0].update() * SCALE * SCALE;
			this.vel.y = this.tilePos[1].update() * SCALE * SCALE;
		} else {
			this.vel.x = 0;
			this.vel.y = 0;
			if( ig.input.state('rotateleft') ) {
				this.angle.add((90).toRad());
			} else if( ig.input.state('rotateright') ) {
				this.angle.add((-90).toRad());
			}

			if( !this.pendingMove && ig.input.state('forward') ) {
				window.stitchClient.callFunction('move', [this.moveCommand(1)]).catch((err) => {
					console.error(err);
				});
				this.pendingMove = true;
			} else if( !this.pendingMove && ig.input.state('back') ) {
				window.stitchClient.callFunction('move', [this.moveCommand(-1)]).catch((err) => {
					console.error(err);
				});
				this.pendingMove = true;
			}

			// Shoot
			if(
				this.currentWeapon &&
				this.angle.isDone() &&
				( ig.input.state('shoot') ||  (!ig.ua.mobile && ig.input.state('click')) )
			) {
				// Calculate the spawn position for projectiles
				var sx = this.pos.x+this.size.x/2 -Math.sin(this.angle.curValue) * 3;
					sy = this.pos.y+this.size.y/2 -Math.cos(this.angle.curValue) * 3;

				if( !this.currentWeapon.depleted() ) {
					this.currentWeapon.trigger( sx, sy, this.angle.curValue );
				}
				else {
					// find the first weapon that has ammo
					this.switchToNextNonEmptyWeapon();
				}
			}

			// Change Weapon; be careful to only switch after the shoot button was released
			if( this.delayedWeaponSwitchIndex >= 0 ) {
				this.switchWeapon( this.delayedWeaponSwitchIndex );
			}

			if( ig.input.pressed('weaponNext') && this.weapons.length > 1 ) {
				this.switchWeapon( (this.currentWeaponIndex + 1) % this.weapons.length );
			}
			else if( ig.input.pressed('weaponPrev') && this.weapons.length > 1 ) {
				var index = (this.currentWeaponIndex == 0)
					? this.weapons.length - 1
					: this.currentWeaponIndex - 1;
				this.switchWeapon( index );
			}
		}

		// Calculate new position based on velocity; update sector and light etc...
		this.parent();

		if( this.currentWeapon ) {
			this.currentWeapon.update();
		}

		// Update camera position and view angle
		var cx = this.pos.x + this.size.x / 2,
			cy = this.pos.y + this.size.y / 2;

		document.getElementById('foo').innerText = `${Math.round(cx)},${Math.round(cy)}\n${Math.round(this.angle.curValue)}`;
		ig.system.camera.setRotation( 0, 0, this.angle.curValue );
		ig.system.camera.setPosition( cx, cy, 0 );
	},

	receiveDamage: function( amount, from ) {
		if( this.god || this._killed ) {
			return;
		}

		// Figure out where the damage came from and show the damage indicator
		// accordingly on the HUD
		var a = (this.angle + this.angleTo(from)) % (Math.PI*2);
		a += a < 0 ? Math.PI : -Math.PI;

		var xedge = ig.game.hud.width/2;
		var ypos = a < 0 ? ig.game.hud.height/2 : 0;
		var xpos = Math.abs(a).map( 0, Math.PI, -xedge, xedge );

		ig.game.hud.showDamageIndicator( xpos, ypos, 1 );

		this.hurtSounds.random().play();
		this.parent( amount, from );
	},

	kill: function() {
		ig.game.hud.showMessage('You are Dead!', tpf.Hud.TIME.PERMANENT);
		ig.game.showDeathAnim();
		this.parent();
		this.isSpawned = false;
	},

	giveWeapon: function( weaponClass, ammo ) {
		// Do we have this weapon already? Add ammo!
		var index = -1;
		for( var i = 0; i < this.weapons.length; i++ ) {
			var w = this.weapons[i];
			if( w instanceof weaponClass ) {
				index = i;
				w.giveAmmo( ammo );
			}
		}

		// New weapon?
		if( index === -1 ) {
			this.weapons.push( new weaponClass(ammo) );
			index = this.weapons.length - 1;
		}

		this.switchWeapon( index );
	},

	giveAmmo: function( weaponClass, ammo ) {
		for( var i = 0; i < this.weapons.length; i++ ) {
			var w = this.weapons[i];
			if( w instanceof weaponClass ) {
				w.giveAmmo( ammo );
			}
		}
	},

	giveHealth: function( amount ) {
		if( this.health >= this.maxHealth ) {
			return false;
		}

		this.health = Math.min(this.health + amount, this.maxHealth);
		return true;
	},

	switchWeapon: function( index ) {
		if( this.currentWeapon ) {
			if( this.currentWeapon.shootTimer.delta() < 0 ) {
				this.delayedWeaponSwitchIndex = index;
				return;
			}
		}

		this.delayedWeaponSwitchIndex = -1;
		this.currentWeaponIndex = index;
		this.currentWeapon = this.weapons[index];

		if( this.currentWeapon.ammoIcon ) {
			this.currentWeapon.ammoIcon.setPosition(
				215,
				ig.game.hud.height-this.currentWeapon.ammoIcon.tileHeight-6
			);
		}

		// Make sure the lighting for the weapon is updated
		this.currentWeapon.setLight( this.currentLightColor );
	},

	switchToNextNonEmptyWeapon: function() {
		for( var i = this.currentWeaponIndex+1; i < this.weapons.length; i++ ) {
			if( !this.weapons[i].depleted() ) {
				this.switchWeapon(i);
				this.currentWeapon.shootTimer.set(0.5);
				return;
			}
		}

		for( var i = 0; i < this.currentWeaponIndex; i++ ) {
			if( !this.weapons[i].depleted() ) {
				this.switchWeapon(i);
				this.currentWeapon.shootTimer.set(0.5);
				return;
			}
		}
	},

	setLight: function( color ) {
		this.currentLightColor = color;
		if( this.currentWeapon ) {
			this.currentWeapon.setLight( color );
		}
	},

	moveCommand: function(magnitude) {
		const theta = this.angle.curValue;
		const moveX = -Math.round(Math.sin(theta));
		const moveY = -Math.round(Math.cos(theta));

		return {
				curX: this.tilePos[0].curValue,
				curY: this.tilePos[1].curValue,
				moveX: moveX * magnitude,
				moveY: moveY * magnitude
		}
	}
});

});
