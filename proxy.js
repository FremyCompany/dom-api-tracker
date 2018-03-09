//
// Documentation:
// ================
// This project is a template script you can customize then insert at the begining of your document.
// It will enable you to log which native functions are being called by your application.
// You can filter the log to only include particular instances like slow function calls.
// You can also log more information like the call stack at the time of the log.
//
void function() {

	//
	// Import stuff we want to use (before we wrap or replace them, eventually)
	//

	var console = window.console;
	/** @type {ObjectConstructor}    */ var Object = window.Object;
	/** @type {FunctionConstructor}  */ var Function = window.Function;
	/** @type {SetConstructor}       */ var Set = window.Set;
	/** @type {ProxyConstructor}     */ var Proxy = window.Proxy;
	/** @type {WeakMapConstructor}   */ var WeakMap = window.WeakMap;
	/** @type {SymbolConstructor}    */ var Symbol = window.Symbol;

	var functionToString = Function.prototype.toString;
	var objectToString = Object.prototype.toString;
	var bindFunction = Function.prototype.bind;

	//
	// Prerequirement: be able to distinguish between native and bound functions
	// This is done by adding a tag to user-functions returned by "func.bind(obj)"
	//

	var isNativeFunction_map = new WeakMap();
	var isNativeFunction = function(f) {

		if(typeof(f) != 'function') { /*debugger;*/ return false; }

		var isKnownNativeFunction = isNativeFunction_map.get(f);
		if(isKnownNativeFunction !== undefined) return isKnownNativeFunction;
		
		var isNative = (
			/^function[^]*?\([^]*?\)[^]*?\{[^]*?\[native code\][^]*?\}$/m.test(functionToString.call(f))
		);

		isNativeFunction_map.set(f, isNative);
		return isNative;

	};

	var shouldBeWrapped = function(f) {
		return !isAlreadyWrapped(f) && isFromThisRealm(f) && (!~objectsToNeverWrapProperties.indexOf(f)) && (typeof(f) == 'function' ? isNativeFunction(f) : (f.constructor ? f.constructor !== Object && isNativeFunction(f.constructor) : false));
	}

	Function.prototype.bind = function() {
		var boundFunction = bindFunction.apply(this, arguments);
		isNativeFunction_map.set(boundFunction, false);
		return boundFunction;
	};

	// 
	// Sepcial logic to try to catch Event objects before they leak unwrapped to event listeners callbacks
	// 
	var aEL = EventTarget.prototype.addEventListener;
	var rEL = EventTarget.prototype.removeEventListener;
	var aEL_map = new WeakMap();
	var aEL_box = function(fn) {
		var aEL_fn = aEL_map.get(fn);
		if(!aEL_fn) {
			aEL_fn = function(...args) {
				return fn.apply(wrapInProxy(this,undefined), args.map(arg => wrapInProxy(arg,undefined)))
			}
			aEL_map.set(fn, aEL_fn);
		}
		return aEL_fn;
	}

	EventTarget.prototype.addEventListener = function(eventName, callback, options) {
		if(!callback) return;
		var This = unbox(this);
		var boxed_callback = aEL_box(callback)
		aEL.call(This, eventName, boxed_callback, options);
	}

	EventTarget.prototype.removeEventListener = function(eventName, callback, options) {
		if(!callback) return;
		var This = unbox(this);
		var wrapper = aEL_map.get(callback) || callback;
		rEL.call(This, eventName, wrapper, options);
	}

	//
	// Helper:
	// Returns trus if the object is from this window
	// Returns false if the object is from another iframe/window
	//
	var isFromThisRealm = function(obj) {
		return (obj instanceof Object);
	}

	//
	// Helper:
	// Returns "Object", "Array", "Window", or another native type value
	//

	var getNativeTypeOf = function(o) {
		try { o = unbox(o); } catch(ex) {}
		var s = objectToString.call(o);
		var i = '[object '.length;
		return s.substr(i,s.length-i-1);
	};

	//
	// Helper:
	// Returns "Object", "Array", "Window", or another native type value
	// The difference with the above function is that if possible the name of the prototype linked to property "key" is used
	//

	function getNativePrototypeTypeOf(obj, key) {
		var fallbackName = getNativeTypeOf(obj);
		try {
			while(!Object.hasOwnProperty.call(obj, key)) {
				obj = Object.getPrototypeOf(obj);
			}
			return getNativeTypeOf(obj);
		} catch (ex) {
			// give up
		}
		return fallbackName;
	}

	//
	// Helper:
	// Returns a string representation of an object key (o[key] or o.key)
	//

	var getKeyAsStringFrom = function(o) {
		try { if(typeof(o) == 'symbol') { return `[${o.toString()}]`; } } catch(ex) { return '[symbol]' }
		try { if(/^[0-9]+$/.test(o)) { return '[int]'; } } catch (ex) {}
		try { return `${o}` } catch (ex) {}
		try { return `[${o.toString()}]`; } catch (ex) {}
		try { if(o.constructor) return '['+o.constructor.name+']'; } catch (ex) {}
		return '[???]';
	}

	//
	// Helper:
	// Returns the property descriptor, eventually from a prototype
	//
	var getPropertyDescriptorOf = function(o, k) {
		try {
			var property = Object.getOwnPropertyDescriptor(o,k);
			let proto = o;
			while(!property && proto) {
				proto=Object.getPrototypeOf(proto);
				property = proto ? Object.getOwnPropertyDescriptor(proto,k) : null;
			}
		} catch (ex) {/*debugger;*/}
		return property;
	}

	//
	// Storage of the proxy-object to/from source-object links
	//

	var stp_map = new WeakMap();
	var pts_map = new WeakMap();
	var unbox = function(obj) { var proxyInfo = pts_map.get(obj); return proxyInfo && proxyInfo.this ? proxyInfo.this : obj; }
	var unboxName = function(obj) { var proxyInfo = pts_map.get(obj); return proxyInfo ? proxyInfo.name : undefined; }
	var isAlreadyWrapped = function(obj) { return obj === null || obj === undefined || (typeof(obj) != 'object' && typeof(obj) != 'function') || pts_map.has(obj); };

	//
	// This is the algorithm we want to run when an API is being used
	//

	// CUSTOMIZE HERE:
	// this is where we will store our information, we will export it as window.log on the page
	var log = new Array();
	function add_log(name) {
		log.push(name);
	}
	/*
	var log = new Set();
	function add_log(name) {
		log.add(name);
	}
	*/

	// this is how operations on the proxies will work:
	var proxyCode = {

		// htmlElement.innerHTML (o = htmlElement, k = "innerHTML")
		get(o,k) {

			try {

				// if we want to measure how long this operation took:
				//var operationTime = -performance.now()

				// get the value from the source object
				var returnValue = o[k];

			} finally {

				// if we want to know how long this operation took:
				//operationTime += performance.now();

				// CUSTOMIZE HERE:
				var property = getPropertyDescriptorOf(o, k);
				if(!property.get || isNativeFunction(property.get)) {
					try { var name = `${getNativePrototypeTypeOf(o,k)}.${getKeyAsStringFrom(k)}`; } catch (ex) {/*debugger;*/};
					try { if(name) add_log(`${name}`) } catch (ex) {/*debugger;*/};
				}

			}

			// since we want to continue to receive usage info for the object we are about to return...
			if(returnValue && shouldBeWrapped(returnValue)) {

				// first, we need to know if we can wrap it in a proxy...

				var property = getPropertyDescriptorOf(o, k);
				var doesPropertyAllowProxyWrapping = !property || (property.set || property.writable) || property.configurable;

				if(doesPropertyAllowProxyWrapping) {

					// if we can, that is the best option
					returnValue = wrapInProxy(returnValue, undefined);

				} else {

					// if not (rare) we will do our best by special-casing the object
					try { wrapPropertiesOf(returnValue,name); } catch (ex) {/*debugger;*/}
				}

			}

			return returnValue;

		},

		// htmlElement.innerHTML = responseText; (o = htmlElement, k = "innerHTML", v = responseText)
		set(o,k,v) {

			try {

				// if we want to measure how long this operation took:
				//var operationTime = -performance.now()

				// set the value on the source object
				o[k]=v;

			} finally {

				// if we want to know how long this operation took:
				//operationTime += performance.now();

				// CUSTOMIZE HERE:
				var property = getPropertyDescriptorOf(o, k);
				if(!property.set || isNativeFunction(property.set)) {
					try {
						var name = `${getNativePrototypeTypeOf(o,k)}.${getKeyAsStringFrom(k)}=${getNativeTypeOf(v)}`;
						add_log(name)
					} catch (ex) {/*debugger;*/};
				}

			}

			return true;
		},

		// htmlElement.focus(); (o = htmlElement.focus, t = htmlElement, a = [])
		apply(o,t,a) {

			// special rule: if we are calling a native function, none of the arguments can be proxies
			if(isNativeFunction(o)) {
				t = unbox(t);
				a=a.map(a => unbox(a));
			}

			try {

				// if we want to measure how long this operation took:
				//var operationTime = -performance.now()

				// call the function and return its result
				var returnValue = o.apply(t,a);

			} finally {

				// if we want to know how long this operation took:
				//operationTime += performance.now();

				// CUSTOMIZE HERE:
				if(isNativeFunction(o)) {
					var name = `${unboxName(o) || ''}`;
					if(!name && o.name) {
						try {name = `${unboxName(o)||(getNativePrototypeTypeOf(t||window,o.name)+'.'+getKeyAsStringFrom(o.name))}`; } catch (ex) {/*debugger;*/};
					}
					if(!name) {
						try { name = `${unboxName(o)||(getNativeTypeOf(t||window)+'.'+'[???]')}`; } catch (ex) {/*debugger;*/};
					}
					try { name = `${name}(${a.map(x=>getNativeTypeOf(x)).join(',')})`; } catch (ex) { /*debugger;*/ };
					try { add_log(`${name}`) } catch (ex) {}
				}
			}

			return wrapInProxy(returnValue,name);

		},

		// new CustomEvent("click"); (o = CustomEvent, a = ["click"])
		construct(o,a) {

			// special rule: if we are calling a native function, none of the arguments can be proxies
			if(isNativeFunction(o)) {
				a=a.map(a => unbox(a));
			}

			try {

				// if we want to measure how long this operation took:
				//var operationTime = -performance.now()

				// create a new instance of the object, and return it
				var returnValue = wrapInProxy(Reflect.construct(o,a), undefined);

			} finally {

				// if we want to know how long this operation took:
				//operationTime += performance.now();

				// CUSTOMIZE HERE:
				if(isNativeFunction(o)) {
					var name = `${unboxName(o) || ''}`;
					if(!name && o.name) {
						try {name = `${unboxName(o)||getKeyAsStringFrom(o.name)}`; } catch (ex) {/*debugger;*/};
					}
					if(!name) {
						try { name = `${unboxName(o)||getNativeTypeOf(returnValue)}`; } catch (ex) {/*debugger;*/};
					}
					try { name = `new ${name}`; } catch (ex) { /*debugger;*/ };
					try { name = `${name}(${a.map(x=>getNativeTypeOf(x)).join(',')})`; } catch (ex) { /*debugger;*/ };
					try { add_log(`${name}`) } catch (ex) {}
				}

			}

			return returnValue;

		}
	};

	//
	// Helper:
	// Creates a proxy for the given source object and name, if needed (and return it)
	//
	function wrapInProxy(obj,name) {

		// special rule: non-objects do not need a proxy
		if(obj === null) return obj;
		if(obj === undefined) return obj;
		if(!(typeof(obj) == 'function' || typeof(obj) == 'object')) return obj;
		if(~objectsToNeverWrapInProxy.indexOf(obj)) return obj;

		// special rule: do not try to track cross-document objects
		if(!isFromThisRealm(obj)) { console.warn('Cross-document object detected: ', obj); return obj; }

		// special rule: do not proxy an object that has been special-cased
		if(isAlreadyWrapped(obj)) {
			let pxy = stp_map.get(obj) || obj;
			let objData = pts_map.get(pxy);
			if(!objData.name) { objData.name = name; }
			return pxy;
		}

		// special rule: do not touch an object that is already a proxy
		{
			let pxy = stp_map.get(obj);
			if(pxy) return pxy;
		}

		// do not wrap non-native objects (TODO: expand detection?)
		if(!shouldBeWrapped(obj)) { /*debugger;*/ return obj; }

		// wrap the object in proxy, and add some metadata
		try {
			let objData = { this: obj, name: name };
			let pxy = new Proxy(obj, proxyCode);
			stp_map.set(obj, pxy);
			pts_map.set(pxy, objData);
			isNativeFunction_map.set(pxy, false); // HACK: Edge fix

			try {
				// wrap the properties of all prototypes
				let proto = Object.getPrototypeOf(obj);
				while(proto && !isAlreadyWrapped(proto)) {
					wrapPropertiesOf(proto, proto.constructor ? proto.constructor.name : undefined);
					proto = Object.getPrototypeOf(proto);
				}
			} catch (ex) {
				/*debugger;*/
			}

			return pxy;
		} catch (ex) {
			return obj;
		}

	}

	//
	// Helper:
	// Tries to catch get/set on an object without creating a proxy for it (unsafe special case)
	//
	function wrapPropertiesOf(obj, name) {

		// special rule: don't rewrap a wrapped object
		if(isAlreadyWrapped(obj)) return;

		// mark the object as wrapped already
		let objData = { this: obj, name: name };
		pts_map.set(obj, objData);

		// wrap the properties of all prototypes
		let proto = Object.getPrototypeOf(obj);
		while(proto && !isAlreadyWrapped(proto)) {
			wrapPropertiesOf(proto, proto.constructor ? proto.constructor.name : undefined);
			proto = Object.getPrototypeOf(proto);
		}

		if(~objectsToNeverWrapProperties.indexOf(obj)) return;

		// for all the keys of this object
		let objKeys = new Set(Object.getOwnPropertyNames(obj));
		for(let key in obj) { objKeys.add(key) };
		for(let key of objKeys) {
			try {

				// special rule: avoid problematic global properties
				if(obj === window && (key == 'window' || key=='top' || key=='self' || key=='document' || key=='location' || key=='Object' || key=='Array' || key=='Function' || key=='Date' || key=='Number' || key=='String' || key=='Boolean' || key == 'Symbol')) {
					continue;
				}
				if(obj === window.document && (key =='location')) {
					continue;
				}
				if(key == '__proto__' || key == '__lookupGetter__' || key == '__lookupSetter__' || key == '__defineGetter__' || key == '__defineSetter__') {
					continue;
				}
				if(obj == Function.prototype && (key == 'toString')) {
					continue;
				}
				if(obj instanceof Function && (key == 'name' || key == 'length' || key == 'prototype')) {
					continue;
				}

				// TODO?
				// key=='contentWindow' || key=='contentDocument' || key=='parentWindow' || key=='parentDocument' || key=='ownerDocument'

				// try to find where the property has been defined in the prototype chain
				let property = Object.getOwnPropertyDescriptor(obj,key);
				let proto = obj;
				while(!property && proto) {
					proto=Object.getPrototypeOf(proto);
					property = proto ? Object.getOwnPropertyDescriptor(proto,key) : null;
				}
				if(!property) continue;

				// try to find if we can override the property
				// we only need to do this if this is an own property, or we could not configure the property on a prototype
				if((proto !== obj && property.configurable)) { continue; }
				if((proto === obj && property.configurable) || (proto !== obj && !property.configurable)) {

					if(property.get) {

						// in the case of a getter/setter, we can just duplicate
						Object.defineProperty(obj, key, {
							get() {

								// special rule: when setting a value in the native world, we need to unwrap the value
								var t = this;
								if(isNativeFunction(property.get)) {
									t = unbox(this);
								}

								try {

									// if we want to measure how long this operation took:
									//var operationTime = -performance.now()

									// set the value on the source object
									var returnValue = property.get.call(t);

								} finally {

									// if we want to know how long this operation took:
									//operationTime += performance.now();

									// CUSTOMIZE HERE:
									if(isNativeFunction(property.get)) {
										try { add_log(`${getNativeTypeOf(proto)}.${getKeyAsStringFrom(key)}`) } catch (ex) {/*debugger;*/};
									}

								}

								return wrapInProxy(returnValue, name+'.'+key);

							},
							set(v) {

								// special rule: when setting a value in the native world, we need to unwrap the value
								var t = this;
								if(isNativeFunction(property.set)) {
									t = unbox(this);
									v = unbox(v);
								}

								try {

									// if we want to measure how long this operation took:
									//var operationTime = -performance.now()

									// set the value on the source object
									var returnValue = property.set.call(t, v);

								} finally {

									// if we want to know how long this operation took:
									//operationTime += performance.now();

									// CUSTOMIZE HERE:
									if(isNativeFunction(property.set)) {
										try {
											var name = `${getNativeTypeOf(proto)}.${getKeyAsStringFrom(key)}=${getNativeTypeOf(v)}`;
											add_log(name);
										} catch (ex) {/*debugger;*/};
									}

								}

								return returnValue;

							}
						});

					} else if(proto === obj && property.writable) {

						// in the case of a read-write data field, we can only wrap preventively
						if(property.value && shouldBeWrapped(property.value)) {
							try {
								obj[key] = wrapInProxy(property.value,name+'.'+key);
							} catch (ex) {
								console.warn("Read-write property " + key + " of " + getNativeTypeOf(obj) + " object was left unwrapped");
								/*debugger;*/
							}
						}

					} else if(proto !== obj && !property.writable && "value" in property && shouldBeWrapped(property.value)) {

						// in the case of a readonly inherited data field, we can just duplicate
						Object.defineProperty(obj, key, {
							value: wrapInProxy(property.value,name+'.'+key),
							enumerable:property.enumerable,
							writable:false,
						});

					} else if(proto === obj && !property.writable) {

						// we cannot redefine the value of a non-configurable read-only property
						if(property.value && shouldBeWrapped(property.value)) {
							console.warn("Unable to wrap readonly property at this level: ", name, key);
						}

					} else if(proto === obj) {

						if(key != 'URLUnencoded') { // HACK: Edge hack
							console.warn("Unable to wrap strange property: ", name, key);
							/*debugger;*/
						}

					} else {

						// this doesn't need wrapping anyway

					}

				} else if (property.writable) {

					// in the case of a read-write data field, we can try to wrap preventively
					if(property.value && (typeof(property.value) == 'object' || typeof(property.value) == 'function')) {
						try { obj[key] = wrapInProxy(property.value,name+'.'+key); } catch (ex) {/*debugger;*/}
					}

				} else if("value" in property) {

					// in the case of a direct read-only data field, there is nothing we can do
					if(shouldBeWrapped(property.value)) {
						console.warn("Unable to wrap readonly property: ", name, key);
					}

				} else {

					// wtf?
					if(key != 'URLUnencoded') { // HACK: Edge hack
						console.warn("Unable to wrap strange property: ", name, key);
						/*debugger;*/
					}

				}

			} catch (ex) {

				console.warn("Unable to wrap property: ", name, key, ex);

			}
		}
		
	}

	//
	// There are a few objects we don't want to wrap for performance reason
	//

	let objectsToNeverWrapInProxy = [
		Object, Object.prototype, String, String.prototype, Number, Number.prototype, Boolean, Boolean.prototype,
		RegExp, RegExp.prototype, Reflect, Function, Function.prototype,
		Error, Error.prototype, DOMError, DOMError.prototype, DOMException, DOMException.prototype,
		Set, Set.prototype, Set.prototype.add,
		Array, Array.prototype,
		document.location, window.location,
		document, window, parent, top,
		console, console.log, console.__proto__
		// TODO: add more here
	]
	let objectsToNeverWrapProperties = [
		Object, Object.prototype, String, String.prototype, Number, Number.prototype, Boolean, Boolean.prototype,
		RegExp, RegExp.prototype, Reflect, Function, Function.prototype,
		Error, Error.prototype, DOMError, DOMError.prototype, DOMException, DOMException.prototype,
		Set, Set.prototype, Set.prototype.add,
		Array, Array.prototype,
		document.location, window.location,
		parent != window ? parent : undefined,
		top != window ? top : undefined,
		console, console.log, console.__proto__
		// TODO: add more here
	]

	// add all typed arrays and array buffers at once
	for(var key of Object.getOwnPropertyNames(window)) {
		if(typeof(key) == 'string' && ~key.indexOf('Array')) {
			objectsToNeverWrapInProxy.push(window[key]);
			objectsToNeverWrapProperties.push(window[key]);
			if(window[key].prototype) {
				objectsToNeverWrapInProxy.push(window[key].prototype);
				objectsToNeverWrapProperties.push(window[key].prototype);
			}
		}
	}

	/*
	objectsToNeverWrap.forEach(o => {
		o[isAlreadyWrapped] = true; //TODO: unsafe for prototypes because we don't check hasOwnProperty(isAlreadyWrapped) in usage
		if(typeof(o) == 'function') {
			o[isKnownNativeFunction] = true;
		}
	});
	*/

	//
	// Now it is time to wrap the important objects of this realm
	//

	if(window.document) {
		wrapPropertiesOf(window.document, 'document');
	}
	if(window.parent !== window) {
		wrapPropertiesOf(window.parent, 'parent');
	}
	if(window.top !== window) {
		wrapPropertiesOf(window.top, 'top');
	}
	wrapPropertiesOf(window, 'window');

	//
	// Disabled alternatives:
	//

	//wrapPropertiesOf(location, 'location');
	//__window = wrapInProxy(window, 'window');
	//__document = wrapInProxy(document, 'document');
	//__location = wrapInProxy(location, 'location');
	//__top = wrapInProxy(location, 'top');

	//
	// CUSTOMIZE HERE:
	//

	window.log = log;
	log.length = 0;
	/*log.clear();*/

}();
