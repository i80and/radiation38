ig.module(
	'game.main'
)
.requires(
	'impact.game',
	'impact.font',

	'plugins.twopointfive.game',

	'plugins.touch-button',
	'plugins.touch-field',

	'game.levels.base1',
	'game.entities.enemy-blob',

	'game.entities.grenade-pickup',
	'game.entities.health-pickup',


	'game.title',
	'game.hud'

	,'plugins.twopointfive.debug'
)
.defines(function(){ "use strict";

function diffObject(obj1, obj2) {
	delete obj1._id;
	delete obj2._id;

	const keysInObj1 = Object.keys(obj1);
	const keysInObj2 = Object.keys(obj2);
	const result = {
		removed: [],
		modified: [],
		added: []
	};

	// Find modified and removed
	for (let i = 0; i < keysInObj1.length; i += 1) {
		const key = keysInObj1[i];
		if (obj2[key] === undefined) {
			result.removed.push(key);
			continue;
		}

		if (obj1[key] !== obj2[key]) {
			result.modified.push([key, obj2[key]]);
		}
	}

	for (let i = 0; i < keysInObj2.length; i += 1) {
		const key = keysInObj2[i];
		if (obj1[key] === undefined) {
			result.added.push(key);
		}
	}

	return result;
}

const MyGame = tpf.Game.extend({
	sectorSize: 4,
	hud: null,

	state: {},
	enemies: {},
	dead: false,
	menu: null,

	touchButtons: null,
	touchFieldMove: null,
	touchFieldTurn: null,

	gravity: 4,

	blobKillCount: 0,

	powerupSpawnWait: 8,
	powerupSpawnTimer: null,

	init: function() {
		// Setup HTML Checkboxes and mouse lock on click
		if( !ig.ua.mobile ) {
			ig.$('#requestFullscreen').addEventListener('click', function( ev ) {
				ig.system.requestFullscreen();
				ev.preventDefault();
				this.blur();
				return false;
			},false);
		}

		// Setup Controls
		ig.input.bind( ig.KEY.MOUSE1, 'click' );
		if( ig.ua.mobile ) {
			this.setupTouchControls();
		}
		else {
			this.setupDesktopControls();
		}

		window.stateCollection.watch(['state']).then((stream) => {
			stream.onNext((e) => {
				const diff = diffObject(this.state, e.fullDocument);
				this.state = e.fullDocument;
				this.updateState(diff);
			})
		}).catch((err) => {
			console.error(err)
		});

		this.setTitle();
	},

	updateState: function (diff) {
		for (const [key, offset] of diff.modified) {
			const y = Math.floor(offset / 32);
			const x = offset - (32 * y);

			if (key === window.stitchClient.auth.user.id) {
				// Player moved
				this.player.moveTo(x, y);
			} else {
				// Guest moved
				if (this.enemies[key] === undefined) {
					this.enemies[key] = this.spawnEntity(EntityEnemyBlob, x, y);
				} else {
					this.enemies[key].moveTo(x, y);
				}
			}
		}
	},

	setTitle: function() {
		this.menu = new MyTitle();
	},

	setGame: function() {
		this.menu = null;
		this.dead = false;
		this.hud = new MyHud( 640, 480 );

		this.blobKillCount = 0;
		this.powerupSpawnTimer = new ig.Timer(this.powerupSpawnWait);

		// Load the last level we've been in or the default Base1
		this.loadLevel( this.lastLevel || LevelBase1 );
	},

	setupDesktopControls: function() {
		// Setup keyboard & mouse controls
		ig.input.bind( ig.KEY.C, 'shoot' );
		ig.input.bind( ig.KEY.ENTER, 'shoot' );
		ig.input.bind( ig.KEY.V, 'weaponNext' );

		ig.input.bind( ig.KEY.W, 'forward' );
		ig.input.bind( ig.KEY.Q, 'rotateleft' );
		ig.input.bind( ig.KEY.A, 'stepleft' );
		ig.input.bind( ig.KEY.S, 'back' );
		ig.input.bind( ig.KEY.E, 'rotateright' );
		ig.input.bind( ig.KEY.D, 'stepright' );

		ig.input.bind( ig.KEY.CTRL, 'shoot' );

		ig.input.bind( ig.KEY.MWHEEL_UP, 'weaponNext' );
		ig.input.bind( ig.KEY.MWHEEL_DOWN, 'weaponPrev' );
	},

	setupTouchControls: function() {
		if( this.touchButtons ) { this.touchButtons.remove(); }
		if( this.touchFieldMove ) { this.touchFieldMove.remove(); }
		if( this.touchFieldTurn ) { this.touchFieldTurn.remove(); }

		// Touch buttons are anchored to either the left or right and top or bottom
		// edge of the screen.
		this.touchButtons = new ig.TouchButtonCollection([
			new ig.TouchButton( 'shoot', {right: 0, bottom: 0}, ig.system.width/2, ig.system.height/4 )
		]);
		this.touchButtons.align();

		this.touchFieldMove = new ig.TouchField(0, 0, ig.system.width/2, ig.system.height);
		this.touchFieldTurn = new ig.TouchField(ig.system.width/2, 0, ig.system.width/2, ig.system.height/4*3);
	},

	loadLevel: function( data ) {
		this.lastLevel = data;
		this.clearColor = null;

		// Find the info entity
		var info = null;
		for( var i = 0; i < data.entities.length; i++ ) {
			if( data.entities[i].settings && data.entities[i].settings.name == 'info' ) {
				info = data.entities[i].settings;
			}
		}

		// Use the sector size specified in the info entity or default (4)
		this.sectorSize = (info && info.sectorSize) || 4;

		// Load the map
		this.parent( data );

		// Set the fog and fog color (never use fog on mobile)
		if( info && typeof info.fogColor !== 'undefined' && !ig.ua.mobile ) {
			ig.system.renderer.setFog( parseInt(info.fogColor), info.fogNear, info.fogFar );
		}
		else {
			ig.system.renderer.setFog( false );
		}

		// Remember the floor map, so we know where we can spawn entities
		this.floorMap = this.getMapByName('floor');
	},

	update: function() {
		if( this.menu ) {
			// If we have a menu don't update anything else
			this.menu.update();
			return;
		}

		if( this.dead ) {
			// Wait for keypress if we are dead
			if( ig.input.released('shoot') || (!ig.ua.mobile && ig.input.released('click')) ) {
				this.setTitle();
			}
		}
		else {
			if( this.powerupSpawnTimer.delta() > 0 ) {
				this.spawnPowerup();
			}
		}

		// Update all entities and backgroundMaps
		this.parent();

		// Roll the death animation; just move the camera down a bit.
		if( this.deathAnimTimer ) {
			var delta = this.deathAnimTimer.delta();
			if( delta < 0 ) {
				ig.system.camera.position[1] = delta.map(
					-this.deathAnimTimer.target, 0,
					0, -ig.game.collisionMap.tilesize / 4
				);
			}
			else {
				this.deathAnimTimer = null;
				this.dead = true;
			}
		}
	},

	spawnBlob: function() {
		var spawnPos = null,
			playerPos = this.player.pos;

		// Try a few times to find a spawn position that's not too close
		// to the player
		for( var i = 0; i < 10; i++ ) {
			spawnPos = this.getRandomSpawnPos();
			if( Math.abs(spawnPos.x - playerPos.x) + Math.abs(spawnPos.y - playerPos.y) > 256 ) {
				// Far enough; all good!
				break;
			}
		}
		this.spawnEntity(EntityEnemyBlobSpawner, spawnPos.x, spawnPos.y);
	},

	spawnPowerup: function() {
		// 1/3 chance for health, 2/3 chance for grenades
		var powerups = [EntityHealthPickup, EntityGrenadePickup, EntityGrenadePickup];
		var entityClass = powerups.random();

		var pos = this.getRandomSpawnPos();
		this.spawnEntity(entityClass, pos.x, pos.y);

		this.powerupSpawnTimer.reset();
	},

	getRandomSpawnPos: function() {
		// This randomly probes the floor map and stops at the first tile
		// that is set. If the floor map is empty, this results in an
		// endless loop, so... better have a floor map in your level!
		var ts = this.floorMap.tilesize;
		while( true ) {
			var x = ((Math.random() * this.floorMap.width)|0) * ts + ts/2,
				y = ((Math.random() * this.floorMap.height)|0) * ts + ts/2;

			if( this.floorMap.getTile(x, y) ) {
				return { x: x, y:y };
			}
		}
	},

	showDeathAnim: function() {
		this.deathAnimTimer = new ig.Timer( 1 );
	},

	drawWorld: function() {
		this.parent();
	},

	drawHud: function() {
		ig.system.renderer.hudFreelook = false;
		if( this.player ) {
			ig.game.hud.draw(this.player, this.player.currentWeapon);
		}

		if( this.menu ) {
			ig.system.renderer.hudFreelook = true;
			this.menu.draw();
		}
	}
});


document.body.className =
	(ig.System.hasWebGL() ? 'webgl' : 'no-webgl') + ' ' +
	(ig.ua.mobile ? 'mobile' : 'desktop');


var width = 640;
var height = 480;

if( window.Ejecta ) {
	var canvas = ig.$('#canvas');
	width = window.innerWidth;
	height = window.innerHeight;

	canvas.style.width = window.innerWidth + 'px';
	canvas.style.height = window.innerHeight + 'px';
}
else if( ig.ua.mobile ) {
	ig.$('#game').className = 'mobile';
	var canvas = ig.$('#canvas');

	// Listen to the window's 'resize' event and set the canvas' size each time
	// it changes.
	// Wait 16ms, because iOS might report the wrong window size immediately
	// after rotation.
	window.addEventListener('resize', function(){ setTimeout(function(){
		if( ig.system ) { ig.system.resize( window.innerWidth, window.innerHeight ); }
		if( ig.game ) { ig.game.setupTouchControls(); }
	}, 16); }, false);

	width = window.innerWidth;
	height = window.innerHeight;
}


ig.Sound.use = [ig.Sound.FORMAT.OGG, ig.Sound.FORMAT.M4A];

// Test WebGL support and init
if( ig.System.hasWebGL() ) {
	ig.main( '#canvas', MyGame, 60, width, height, 1, tpf.Loader );
}
else {
	ig.$('#game').style.display = 'none';
	ig.$('#no-webgl').style.display = 'block';
}

});
