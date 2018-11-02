(function() {
    'use strict'

    function loadScript(url) {
        const element = document.createElement('script')
        const promise = new Promise((resolve, reject) => {
            element.onload = resolve
        })

        document.head.appendChild(element)
        element.src = url
        return promise
    }

    function start() {
        window.stateCollection = client.getServiceClient(stitch.RemoteMongoClient.factory, 'mongodb-atlas').db('radiation38').collection('state')
        loadScript('lib/impact/impact.js').then(() =>
            loadScript('lib/game/main.js')
        ).catch((err) => {
            console.error(err)
        })
    }

    const client = stitch.Stitch.initializeDefaultAppClient('radiation38-npffs')
    window.stitchClient = client

    if (client.auth.hasRedirectResult()) {
        client.auth.handleRedirectResult().then(user=>{
            console.log(user)
        })
    }

    if (!client.auth.isLoggedIn) {
        if (localStorage.getItem('apikey')) {
            const credential = new stitch.UserApiKeyCredential(localStorage.getItem('apikey'));
            stitch.Stitch.defaultAppClient.auth.loginWithCredential(credential).then(() => {
                start();
            }).catch((err) => {
                console.error(err);
            });
            return;
        }
        client.auth.loginWithRedirect(new stitch.FacebookRedirectCredential())
        return
    }

    start();
})()
