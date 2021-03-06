/*global enyo,ares,async,Ares,Phonegap,XMLWriter,ServiceRegistry*/
/**
 * Kind to manage the life cycle of building a mobile application using 
 * the service Phonegap build.
 */
enyo.kind({
	name: "Phonegap.Build",
	kind: "enyo.Component",
	events: {
		onLoginFailed: "",
		onShowWaitPopup: ""
	},
	published: {
		timeoutDuration: 3000
	},	
	components: [
		{kind: "Phonegap.BuildStatusUI",
		 name: "buildStatusPopup"
		}
	],
	debug: true,
	/**
	 * @private
	 */
	create: function() {
		if (this.debug) this.log();
		this.inherited(arguments);
		this.config = {};
	},

	/**
	 * Set Phonegap.Build base parameters.
	 * 
	 * This method is not expected to be called by anyone else but
	 * {ServiceRegistry}.
	 * @param {Object} inConfig
	 * @see ServiceRegistry.js
	 */	
	setConfig: function(inConfig) {
		var self = this;

		if (this.debug) this.log("config:", this.config, "+", inConfig);
		this.config = ares.extend(this.config, inConfig);
		if (this.debug) this.log("=> config:", this.config);

		if (this.config.origin && this.config.pathname) {
			this.url = this.config.origin + this.config.pathname;
			if (this.debug) this.log("url:", this.url);
		}
	},

	/**
	 * @return {Object} the configuration this service was configured by
	 */
	getConfig: function() {
		return this.config;
	},

	/**
	 * @return the human-friendly name of this service
	 */
	getName: function() {
		return this.config.name || this.config.id;
	},

	/**
	 * Default configuration used when a new project is created.
	 * The Project configuration is transformed into a config.xml
	 * file at each build.  It is later expected to be modified by
	 * the UI kind returned by
	 * {PhoneGap.Build#getProjectPropertiesKind}.
	 * 
	 * @public
	 */
	getDefaultProjectConfig: function() {
		return ares.clone(Phonegap.Build.DEFAULT_PROJECT_CONFIG);
	},

	/**
	 * Name of the kind to show in the {ProjectProperties} UI
	 * @return the Enyo kind to use to set service-specific project properties
	 * @public
	 */
	getProjectPropertiesKind: function() {
		return "Phonegap.ProjectProperties";
	},

	/**
	 * @return true when configured, authenticated & authorized
	 */
	isOk: function() {
		return !!(this.config &&
			  this.config.auth &&
			  this.config.auth.token &&
			  this.config.auth.keys);
	},

	/**
	 * Shared enyo.Ajax error handler
	 * @private
	 */
	_handleServiceError: function(message, next, inSender, inError) {
		var response = inSender.xhrResponse, contentType, html, text;
		if (response) {
			contentType = response.headers['content-type'];
			if (contentType) {
				if (contentType.match('^text/plain')) {
					text = response.body;
				}
				if (contentType.match('^text/html')) {
					html = response.body;
				}
			}
		}
		if (inError && inError.statusCode === 401) {
			// invalidate token
			this.config.auth.token = null;
			ServiceRegistry.instance.setConfig(this.config.id, {auth: this.config.auth});
		}
		var err = new Error(message + " (" + inError.toString() + ")");
		err.html = html;
		err.text = text;
		next(err);
	},

	/**
	 * Authenticate current user & retreive the associated token
	 * 
	 * If successful, #username, #password & the token are save to
	 * the browser client localStorage.
	 * 
	 * @param {Object} auth contains the properties #username and #password
	 * @param {Function} next is a CommonJS callback
	 * @public
	 */
	authenticate: function(inAuth, next) {
		if (this.debug) this.log();
		this.config.auth = {
			username: inAuth.username,
			password: inAuth.password
		};
		this._getToken(next);
	},

	/**
	 * Authorize & then retrieve information about the currently registered user
	 * 
	 * This includes registered applications & signing keys.
	 * @public
	 * @param {Function} next
	 * @param next {Error} err
	 * @param next {Object} userData user account data as returned by PhoneGap Build
	 */
	authorize: function(next) {
		var self = this;
		if (this.debug) this.log();
		this._getUserData(function(err, userData) {
			if (err) {
				self._getToken(function(err) {
					if (err) {
						self.doLoginFailed({id: self.config.id});
						next(err);
					} else {
						self._getUserData(next);
					}
				});
			} else {
				next(null, userData);
			}
		});
	},

	/**
	 * Get a developer token from user's credentials
	 * @param {Function} next is a CommonJS callback
	 * @private
	 */
	_getToken: function(next) {
		if (this.debug) this.log();
		if(this.config.auth && this.config.auth.token) {
			if (this.debug) this.log("skipping token obtention");
			next();
			return;
		}

		// Pass credential information to get a phonegapbuild token
		var data = "username=" + encodeURIComponent(this.config.auth.username) +
			    "&password=" + encodeURIComponent(this.config.auth.password);
		
		// Get a phonegapbuild token for the Hermes build service
		var req = new enyo.Ajax({
			url: this.url + '/token',
			method: 'POST',
			postBody: data
		});
		req.response(this, function(inSender, inData) {
			this.config.auth.token = inData.token;
			if (this.debug) this.log("Got phonegap token:", this.config.auth.token);
			// store token
			ServiceRegistry.instance.setConfig(this.config.id, {auth: this.config.auth});
			next();
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to obtain PhoneGap security token", next));
		req.go();
	},

	/**
	 * Get a developer account information
	 * @param {Function} next is a CommonJS callback
	 * @private
	 */
	_getUserData: function(next) {
		if (this.debug) this.log();
		var req = new enyo.Ajax({
			url: this.url + '/api/v1/me'
		});
		req.response(this, function(inSender, inData) {
			if (this.debug) this.log("inData: ", inData);
			this._storeUserData(inData.user);
			next(null, inData);
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to get PhoneGap user data", next));
		req.go();
	},	

	/**
	 * This function send an Ajax request to Node.js in order to get all the
	 * details about the project built in Phongap platform.
	 * 
	 * @param  {Object}   project contain informations about the Ares project
	 * @param  {Object}  inData  contains detailed informations about the built
	 *                           application on Phonegap
	 * @param  {Function} next    is a CommonJS callback
	 * @private
	 */
	_getBuildStatus: function(project, inData, next){
		var config = project.getConfig().getData();
		var appId = config.providers.phonegap.appId;
		var url = this.url + '/api/v1/apps/' + appId;
		
		//Creation of the Ajax request
		var req = new enyo.Ajax({
			url: url
		});

		//in case of sucess send the obtained JSON object to the next function
		//in the Async.waterfall.
		req.response(this, function(inSender, inData) {
			// activate the pop up to view the results
			next(null, inData);
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to get application build status", next));
		req.go(); 
	},
	
	/**
	 * Show the pop-up containing informations about the previous  build of the 
	 * selected project from the project list view.
	 * 
	 * @param  {Object}   project contain a description about the current selected
	 *                          project
	 * @param  {Object}  appData  contains detailed informations about the built
	 *                           application on Phonegap                          
	 * @param  {Function} next    is a CommonJs callback
	 * @private
	 */
	_showBuildStatus: function(project, appData, next){
	 		 	
		this.$.buildStatusPopup.showPopup(project, appData.user);
		next();
     },
	
	/**
	 * Store relevant user account data 
	 * @param {Object} user the PhoneGap account user data
	 * @private
	 */
	_storeUserData: function(user) {
		var keys = this.config.auth.keys || {};
		enyo.forEach(enyo.keys(user.keys), function(target) {
			if (target !== 'link') {
				var newKeys,
				    oldKeys = keys[target],
				    inKeys = user.keys[target].all;
				newKeys = enyo.map(inKeys, function(inKey) {
					var oldKey, newKey;
					newKey = {
						id: inKey.id,
						title: inKey.title
					};
					oldKey = enyo.filter(oldKeys, function(oldKey) {
						return oldKey && (oldKey.id === inKey.id);
					})[0];
					return enyo.mixin(newKey, oldKey);
				});
				keys[target] = newKeys;
			}
		});

		// FIXME do not log 'auth'
		if (this.debug) this.log("keys:", keys);
		this.config.auth.keys = keys;

		ServiceRegistry.instance.setConfig(this.config.id, {auth: this.config.auth});
	},

	/**
	 * Get the key for the given target & id, or the list of keys for the given target
	 * 
	 * @param {String} target the build target, one of ['ios', 'android', ...etc] as defined by PhoneGap
	 * @param {String} id the signing key id, as defined by PhoneGap
	 * 
	 * @return If the key id is not provided, this method returns
	 * an {Array} of keys available for the given platform.  If
	 * the given key id does not represent an existing key, this
	 * method returns undefined.
	 * 
	 * @public
	 */
	getKey: function(target, id) {
		var keys = this.config.auth.keys && this.config.auth.keys[target], res;
		if (id) {
			res = enyo.filter(keys, function(key) {
				return (key.id === id);
			}, this)[0];
		} else {
			res = keys;
		}
		if (this.debug) this.log("target:", target, "id:", id, "=> keys:", res);
		return res;
	},

	/**
	 * Set the given signing key for the given platform
	 * 
	 * Unlike the key {Object} stored on PhoneGap build (which
	 * only has an #id and #title property), the given key is
	 * expected to contain the necessary credentails properties
	 * for the current platform (#password for 'ios' and
	 * 'blackberry', #key_pw and #keystore_pw for 'android').
	 * 
	 * This method automatically saves the full signing keys in
	 * the browser client localStorage.
	 * 
	 * @param {String} target the PhoneGap build target
	 * @param {Object} key the signing key with credential properties
	 * @return {undefined}
	 */
	setKey: function(target, inKey) {
		var keys, key;

		if (( ! inKey) || typeof inKey.id !== 'number' || typeof inKey.title !== 'string') {
			this.warn("Will not store an invalid signing key:", inKey);
			return;
		}

		// Sanity
		this.config.auth.keys = this.config.auth.keys || {};
		this.config.auth.keys[target] = this.config.auth.keys[target] || [];

		// Look for existing values
		keys = this.config.auth.keys && this.config.auth.keys[target];
		key =  enyo.filter(keys, function(key) {
			return (key.id === inKey.id);
		}, this)[0];
		if (key) {
			enyo.mixin(key, inKey);
		} else {
			keys.push(inKey);
		}
		if (this.debug) this.log("target:", target, "keys:", keys /*XXX*/);
		this.config.auth.keys[target] = keys;

		// Save a new authentication values for PhoneGap 
		ServiceRegistry.instance.setConfig(this.config.id, {auth: this.config.auth});
	},

	/**
	 * Initiates the phonegap build of the given project
	 * @see HermesBuild.js
	 *
	 * The following actions will be performed:
	 * - Get a phonegapbuild account token
	 * - Get the file list of the project
	 * - Download all the project files
	 * - Build a multipart/form-data with all the project data
	 * - Send it to nodejs which will submit the build request
	 * - Save the appid
	 * 
	 * @param {Ares.Model.Project} project
	 * @param {Function} next is a CommonJS callback
	 * @public
	 */
	build: function(project, next) {
		if (this.debug) this.log("Starting phonegap build: " + this.url + '/build');
		async.waterfall([
			enyo.bind(this, this.authorize),
			enyo.bind(this, this._updateConfigXml, project),
			enyo.bind(this, this._getFiles, project),
			enyo.bind(this, this._submitBuildRequest, project),
			enyo.bind(this, this._prepareStore, project),
			enyo.bind(this, this._store, project)
		], next);
	},

	/**
	 * Communicate with Phonegap build in order to get the curent status of the
	 * built project for all targeted platforms. This status are showen in a 
	 * Pop-up defined in the file BuildStatusUI.js
	 * 
	 * @param  {Object}   project contain a description about the current selected
	 *                            project
	 * @param  {Function} next    is a CommonJS Callback
	 * @public
	 */
	buildStatus: function(project, next) {
		if (this.debug) this.log("Getting build status:  " + this.url + '/build');
		async.waterfall([
			enyo.bind(this, this.authorize),
			enyo.bind(this, this._getBuildStatus, project),			
			enyo.bind(this, this._showBuildStatus, project)
		], next);
	},

	/**
	 * Collect & check information about current project, update config.xml
	 * @private
	 */
	_updateConfigXml: function(project, userData, next) {
		if (!project instanceof Ares.Model.Project) {
			next(new Error("Invalid parameters"));
			return;
		}
		
		var config = project.getConfig().getData();
		if (this.debug) this.log("starting... project:", project);

		if(!config || !config.providers || !config.providers.phonegap) {
			next(new Error("Project not configured for Phonegap Build"));
			return;
		}
		if (this.debug) this.log("PhoneGap App Id:", config.providers.phonegap.appId);

		var req = project.getService().createFile(project.getFolderId(), "config.xml", this._generateConfigXml(config));
		req.response(this, function _savedConfigXml(inSender, inData) {
			if (this.debug) this.log("Phonegap.Build#_updateConfigXml()", "updated config.xml:", inData);
			var ctype = req.xhrResponse.headers['x-content-type'];
			next();
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to fetch application source code", next));
	},

	/**
	 * Get the list of files of the project for further upload
	 * @param {Object} project
	 * @param {Function} next is a CommonJS callback
	 * @private
	 */
	_getFiles: function(project, next) {
		if (this.debug) this.log("...");
		var req, fileList = [];
		this.doShowWaitPopup({msg: $L("Fetching application source code")});
		req = project.getService().exportAs(project.getFolderId(), -1 /*infinity*/);
		req.response(this, function _gotFiles(inSender, inData) {
			if (this.debug) this.log("Phonegap.Build#_getFiles()", "Got the files data");
			var ctype = req.xhrResponse.headers['x-content-type'];
			next(null, {content: inData, ctype: ctype});
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to fetch application source code", next));
	},

	/**
	 * 
	 * @param {Object} project
	 * @param {FormData} formData
	 * @param {Function} next is a CommonJS callback
	 * @private
	 */
	_submitBuildRequest: function(project, data, next) {
		var config = ares.clone(project.getConfig().getData());
		if (this.debug) this.log("config: ", config);
		var keys = {};
		var platforms = [];
		// mandatory parameters
		var query = {
			//provided by the cookie
			//token: this.config.auth.token,
			title: config.title			
		};

		// Already-created apps have an appId (to be reused)
		if (config.providers.phonegap.appId) {
			if (this.debug) this.log("appId:", config.providers.phonegap.appId);
			query.appId = config.providers.phonegap.appId;
		}

		// Signing keys, if applicable to the target platform
		// & if chosen by the app developper.
		if (typeof config.providers.phonegap.targets === 'object') {
			enyo.forEach(enyo.keys(config.providers.phonegap.targets), function(target) {
				var pgTarget = config.providers.phonegap.targets[target];
				if (pgTarget) {
					if (this.debug) this.log("platform:", target);
					platforms.push(target);
					if (typeof pgTarget === 'object') {
						var keyId = pgTarget.keyId;
						if (keyId) {
							keys[target] = enyo.clone(this.getKey(target, keyId));
							//delete keys[target].title;
							//if (this.debug) this.log("platform:", target, "keys:", keys);
						}
					}
				}
			}, this);
		}
		if (typeof keys ==='object' && enyo.keys(keys).length > 0) {
			if (this.debug) this.log("keys:", keys);
			query.keys = JSON.stringify(keys);
		}

		// Target platforms -- defined by the Web API, but not implemented yet
		if (platforms.length > 0) {
			query.platforms = JSON.stringify(platforms);
		} else {
			next(new Error('No build platform selected'));
			return;
		}

		// Ask Hermes PhoneGap Build service to minify and zip the project
		var req = new enyo.Ajax({
			url: this.url + '/op/build',
			method: 'POST',
			postBody: data.content,
			contentType: data.ctype
		});
		req.response(this, function(inSender, inData) {
			if (this.debug) enyo.log("Phonegap.Build#_submitBuildRequest(): response:", inData);
			if (inData) {
				config.providers.phonegap.appId = inData.id;
				var configKind = project.getConfig();
				configKind.setData(config);
				configKind.save();
			}
			next(null, inData);
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to build application", next));
		req.go(query);
	},

	/**
	 * Prepare the folder where to store the built package
	 * @param  {Object}   project contain a description about the current selected
	 *                          project
	 * @param  {Object}  inData  contains detailed informations about the built
	 *                           application on Phonegap
	 * @param  {Function} next    a CommonJS callback
	 * @private
	 */
	_prepareStore: function(project, inData, next) {
		var folderKey = "build." + this.config.id + ".target.folderId",
		    folderPath = "target/" + this.config.id;
		 this.doShowWaitPopup({msg: $L("Storing Phonegap application package")});

		var folderId = project.getObject(folderKey);
		if (folderId) {
			next(null, folderId, inData);
		} else {
			var req = project.getService().createFolder(project.getFolderId(), folderPath);
			req.response(this, function(inSender, inResponse) {
				if (this.debug) this.log("response:", inResponse);
				folderId = inResponse.id;
				project.setObject(folderKey, folderId);
				next(null, folderId, inData);
			});
			req.error(this, this._handleServiceError.bind(this, "Unable to prepare package storage", next));
		}
	},

	/**
	 * Store the built application file in the directory "<projectName>\target\Phonegap build".
	 *
	 * 
	 * @param  {Object}   project contain a description about the current selected
	 *                            project
	 * @param  {String}   folderId id used in Hermes File system to identify the 
	 *                             target folder where the downloaded applications
	 *                             will be stored.
	 * @param  {Object}   inData   contains detailed informations about the build of
	 *                           the project.
	 * @param  {Function} next     a CommonJs callback.
	 * @private            
	 */
	_storePkg: function(project, folderId, inData, next) {
		if(this.debug){		
			this.log("data content.ctype: ", inData.ctype);	
		}	

		var req = project.getService().createFiles(folderId, 
			{content: inData.content, ctype: inData.ctype});

		req.response(this, function(inSender, inData) {
			if (this.debug) this.log("response:", inData);
			var config = project.getService().config;
			var pkgUrl = config.origin + config.pathname + '/file' + inData[0].path; // TODO: YDM: shortcut to be refined
			project.setObject("build.phonegap.target.pkgUrl", pkgUrl);
			next();
		});
		req.error(this, this._handleServiceError.bind(this, "Unable to store application package", next));
	},	

	/**
	 * After checking that the building of the project is finished in Phongap platform, this 
	 * function send an ajax request to the Node.js in order to launch
	 * the download of the packaged application. 
	 * Node.js succeed in the downloading of this application, 
	 * an Ajax response is sent back in order to save the
	 * file (contained in a multipart data form)in the folder 
	 * "Target/Phonegap build" of the curent built project.
	 * 
	 * @param  {Object}   project contain a description of the current selected
	 *                          project
	 * @param  {Object}   folderId unique identifier of the project in Ares
	 * @param  {Object}   appData  multipart data form containing the application
	 *                             to store
	 * @param  {Function} next     a CommonJs callback
	 
	 * @private
	 */
	_store: function(project, folderId, appData, next) {
		var appKey = "build." + this.config.id + ".app";
		if(this.debug) this.log("Entering _store function project: ", project, "folderId:", folderId, "appData:", appData);
		project.setObject(appKey, appData);
		this._getAllPackagedApplications(project, appData, folderId, next);
	},
	
	/**
	 * 
	 * @param  {Object}   project  contain a description of the current selected
	 *                             project
	 * @param  {Object}   appData  meta-data on the build of the actuel
	 *                             project
	 * @param  {String}   folderId unique identifier of the project in Ares
	 * @param  {Function} next     a CommonJS callback
	 * @private
	 */
	_getAllPackagedApplications: function(project, appData, folderId, next){
		var platforms = [];
		var builder = this;

		//Setting the targeted platforms for the build from the those
		//presented in the object appData.
		enyo.forEach(enyo.keys(appData.status),
			function(platform){
				platforms.push(platform);
			}, this);

		/* 
		 * Parallel tasks are launched to check the build status in each platform.
		 * A status can be : complete, pending or error.
		 *	- completed: a request is made to node.js to 
		 *				download the application.
		 *	- pending: another request is sent to phonegap to check for an
		 *	           updated status.
		 *	- error: an error message is displayed.		
		 */		
		async.forEach(platforms,
		    function(platform, next) {
			if(this.debug){
				this.log("Send request for the platform: ", platform);
			}
			_getApplicationForPlatform(platform, next);
	       },next);
	
		/**
		 * Check continuously the build status of the build in a targeted mobile
		 * platform on Phongap  build service and launch the appropriate action 
		 * when the returned status of the build is
		 * "complete" or "error". 
		 * @param  {Object}   project  contain a description of the current 
		 *                             selected project
		 * @param  {String}   platform targeted platfrom for the build
		 * @param  {Object}   appData  meta-data on the build of the actuel
		 *                             project
		 * @param  {Object}   folderId unique identifier of the project in Ares
		 * @param  {Function} next     a CommonJS callback
		 * @private
		 */
		function _getApplicationForPlatform(platform, next){
			async.whilst(
				function() {
					// Synchronous condition to keep waiting. 
					return appData.status[platform] === "pending";
				},
				// ...condition satisfied
				_waitForApp,
				// ...condition no longer satisfied
				_downloadApp
			);

			/**
			 * Nested function that check the build status of the application 
			 * and update the appData each 3 sec
			 * @param  {Function} next a CommonJS callback
			 * @private
			 */
			function _waitForApp (next){
				async.waterfall([
					function (next) {
						//Timeout before sending a new check status request
						setTimeout(next, builder.timeoutDuration);
					},
					function (next) {
						if(appData.status[platform] === "pending"){
							builder._getBuildStatus(project, appData, next);
						} else{
							next(null, null);
						}
						
					},
					function(inData, next) {
						//get the result from the previous status check request
						if (inData !== null){
							appData = inData.user;
						}					
						next();
					}
				], next);				
			}
			/**
			 * Launch the appropirate action when an exception occurs or when 
			 * the status is no longer in the pending state.
			 * @param  {Object} err 
			 * @private
			 */
			function _downloadApp(err){
				if (err) {
					next(err);
				} else {
					if (appData.status[platform] === "complete"){
						_setApplicationToDownload(next);
					} else {
						next();
					}
				}
			}

			/**
			 * Create the URL to send the build request to Node.js
			 * This URL contain the data to create the packaged file name.
			 *  
			 * @param  {Object}   project  contain a description of the current 
			 *                             selected project
			 * @param  {String}   folderId unique identifier of the project in Ares
			 * @param  {String}   platform targeted platfrom for the build
			 * @param  {Object}   appData  meta-data on the build of the actuel
			 *                             project
			 * @param  {Function} next     a CommonJS callback
			 * @private
			 */
			 function _setApplicationToDownload(next){
				var config = ares.clone(project.getConfig().getData()),
				    packageName = config.id,
				    appId, title, version;

				async.waterfall([
					function(next){
						//make the download request.
						appId = appData.id;
						title = packageName;
						version = appData.version || "SNAPSHOT";
						
						var urlSuffix = appId + '/' + platform + '/' + title + '/' + version;
						if(builder.debug) builder.log("Application "+ platform + " ready for download");
						_sendDownloadRequest.bind(builder)(urlSuffix, next);
					},
					//inData is a multipart/form containing the
					//built application
					function(inData, next){
						builder._storePkg(project, folderId, 
						inData, next);
					}
				], next);
			}

			/**
			 * Send an Ajax request to Node.js in order to initiate the download 
			 * of an application in a specific mobile platform.
			 * 
			 * @param  {Object}   project contain a description about the 
			 *                            current selected project
			 * @param  {Object}   urlSuffix   is a url suffixe that contains:
			 *                                the appId, the targeted build 
			 *                                platform, the title of the 
			 *                                application and its version.
			 * @param  {Function} next    is a CommunJS callback.
			 * @private
			 */
			function _sendDownloadRequest(urlSuffix, next){
				var url = this.url + '/api/v1/apps/' + urlSuffix;
				if (this.debug)	this.log("download URL is : ", url);
				
				var req = new enyo.Ajax({
					url: url,
					handleAs: 'text'
				});		
				req.response(this, function(inSender, inData) {
					if (this.debug) this.log("response: received " + inData.length + " bytes typeof: " + (typeof inData));
					var ctype = req.xhrResponse.headers['content-type'];
					if (this.debug) this.log("response: received ctype: " + ctype);
					next(null, {content: inData, ctype: ctype});			
				});
				req.error(this, this._handleServiceError.bind(this, "Unable to download application package", next));
				req.go(); 
			}	
		}
	},

	/**
	 * Generate PhoneGap's config.xml on the fly
	 * 
	 * @param {Object} config PhoneGap Build config, as a Javascript object
	 * @return {String} or undefined if PhoneGap build is disabled for this project
	 * @private
	 * FIXME: define a JSON schema
	 */
	_generateConfigXml: function(config) {
		var phonegap = config.providers.phonegap;
		if (!phonegap) {
			this.log("PhoneGap build disabled: will not generate the XML");
			return undefined;
		}

		// See http://flesler.blogspot.fr/2008/03/xmlwriter-for-javascript.html

		var str, xw = new XMLWriter('UTF-8');
		xw.indentation = 4;
		xw.writeStartDocument();
		xw.writeComment('***                              WARNING                            ***');
		xw.writeComment('***            This is an automatically generated document.         ***');
		xw.writeComment('*** Do not edit it: your changes would be automatically overwritten ***');

		xw.writeStartElement( 'widget' );

		xw.writeAttributeString('xmlns','http://www.w3.org/ns/widgets');
		xw.writeAttributeString('xmlns:gap','http://phonegap.com/ns/1.0');

		xw.writeAttributeString('id', config.id);
		xw.writeAttributeString('version',config.version);

		// we use 'title' (one-line description) here because
		// 'name' is made to be used by package names
		xw.writeElementString('name', config.title);

		// we have no multi-line 'description' of the
		// application, so use our one-line description
		xw.writeElementString('description', config.title);

		xw.writeStartElement( 'icon' );
		// If the project does not define an icon, use Enyo's
		// one
		xw.writeAttributeString('src', phonegap.icon.src || 'icon.png');
		xw.writeAttributeString('role', phonegap.icon.role || 'default');
		xw.writeEndElement();	// icon

		xw.writeStartElement( 'author' );
		xw.writeAttributeString('href', config.author.href);
		xw.writeString(config.author.name);
		xw.writeEndElement();	// author

		// skip completelly the 'platforms' tags if we target
		// all of them
		if (phonegap.targets && (enyo.keys(phonegap.targets).length > 0)) {
			xw.writeStartElement('platforms', 'gap');
			for (var platformName in phonegap.targets) {
				var platform = phonegap.targets[platformName];
				if (platform !== false) {
					xw.writeStartElement('platform', 'gap');
					xw.writeAttributeString('name', platformName);
					for (var propName in platform) {
						xw.writeAttributeString(propName, platform[propName]);
					}
					xw.writeEndElement(); // gap:platform
				}
			}
			xw.writeEndElement();	// gap:platforms
		}

		// plugins
		if (typeof phonegap.plugins === 'object') {
			for (var pluginName in phonegap.plugins) {
				xw.writeStartElement('plugin', 'gap');
				xw.writeAttributeString('name', pluginName);
				var plugin = phonegap.plugins[pluginName];
				if (typeof plugin === 'object') {
					for (var attr in plugin) {
						xw.writeAttributeString(attr, plugin[attr]);
					}
				}
				xw.writeEndElement(); // gap:plugin
			}
		}

		// UI should be helpful to define the features so that
		// the URL's are correct... I am not sure whether it
		// is possible to have them enforced by a JSON schema,
		// unless we hard-code a discrete list of URL's...
		enyo.forEach(phonegap.features, function(feature) {
			xw.writeStartElement('feature');
			xw.writeAttributeString('name', feature.name);
			xw.writeEndElement(); // feature
		}, this);

		// ...same for preferences
		for (var prefName in phonegap.preferences) {
			xw.writeStartElement('preference');
			xw.writeAttributeString('name', prefName);
			xw.writeAttributeString('value', phonegap.preferences[prefName]);
			xw.writeEndElement(); // preference
		}

		xw.writeEndElement();	// widget

		//xw.writeEndDocument(); called by flush()
		str = xw.flush();
		xw.close();
		if (this.debug) this.log("xml:", str);
		return str;
	},

	statics: {
		DEFAULT_PROJECT_CONFIG: {
			enabled: false,
			icon: {
				src: "icon.png",
				role: "default"
			},
			preferences: {
				"phonegap-version": "2.1.0"
			},
			plugins: {
				"ChildBrowser": {
					version: "2.1.0"
				}
			}
		}
	}
});
