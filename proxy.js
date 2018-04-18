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

	/** @type {Console}              */ const console = window.console;
	/** @type {ObjectConstructor}    */ const Object = window.Object;
	/** @type {FunctionConstructor}  */ const Function = window.Function;
	/** @type {SetConstructor}       */ const Set = window.Set;
	/** @type {ProxyConstructor}     */ const Proxy = window.Proxy;
	/** @type {WeakMapConstructor}   */ const WeakMap = window.WeakMap;
	/** @type {SymbolConstructor}    */ const Symbol = window.Symbol;

	const functionToString = Function.prototype.toString;
	const objectToString = Object.prototype.toString;
	const bindFunction = Function.prototype.bind;

	// (feel free to ignore)
	const true_if_all_of_the_following_are_true = true;
	const true_if_one_of_the_following_is_true = false;

	//
	// Prerequirement: be able to distinguish between native and bound functions
	// This is done by adding a tag to user-functions returned by "func.bind(obj)"
	//

	const isNativeFunction_map = new WeakMap();
	const isNativeFunction = function(f) {

		if(typeof(f) != 'function') { /*debugger;*/ return false; }

		var isKnownNativeFunction = isNativeFunction_map.get(f);
		if(isKnownNativeFunction !== undefined) return isKnownNativeFunction;
		
		var isNative = (
			/^function[^()]*?\([^()]*?\)[^{}]*?\{[^{}]*?\[native code\][^]*?\}$/m.test(functionToString.call(f))
		);

		isNativeFunction_map.set(f, isNative);
		return isNative;

	};

	Function.prototype.bind = function() {
		var boundFunction = bindFunction.apply(this, arguments);
		isNativeFunction_map.set(boundFunction, false);
		return boundFunction;
	};

	//
	// Prerequirement: be able to distinguish between native and js-constructed objects
	//

	const isNativeObject = function(f) {

		if(typeof(f) == 'function') {
			return isNativeFunction(f);

		} else if(typeof(f) != 'object') {
			return false;

		} else if(f && f.constructor) {
			return f.constructor !== Object && isNativeFunction(unbox(f.constructor))

		} else {
			return false;
		}

	}

	// 
	// Sepcial logic to try to catch Event objects before they leak unwrapped to event listeners callbacks
	// 
	const aEL = EventTarget.prototype.addEventListener;
	const rEL = EventTarget.prototype.removeEventListener;
	const aEL_map = new WeakMap();
	const aEL_box = function(fn) {

		// get the callback wrapper we use for function `fn` if there is one already
		var aEL_fn = aEL_map.get(fn);

		// if there is none, create it and save in the cache
		if(!aEL_fn) {
			aEL_fn = function(...args) {
				return fn.apply(
					wrapInProxy(this,'EventTarget<' + getNativeTypeOf(this) + '>'), 
					args.map(arg => wrapInProxy(arg,getNativeTypeOf(arg)))
				);
			}
			aEL_map.set(fn, aEL_fn);
		}

		// return the callback wrapper
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
	// Returns true if the object is from this iframe/window
	// Returns false if the object is from another iframe/window
	//
	const isFromThisRealm = function(obj) {
		return (obj instanceof Object);
	}

	//
	// Helper:
	// Returns "Object", "Array", "Window", or another native type value
	//

	const getNativeTypeOf = function(o) {
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

	const getNativePrototypeTypeOf = function(obj, key) {
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

	const getStringRepresentationOfKey = function(o) {
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

	const getPropertyDescriptorOf = function(o, k) {
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

	const stp_map = new WeakMap();
	const pts_map = new WeakMap();
	const unbox = function(obj) { var proxyInfo = pts_map.get(obj); return proxyInfo && proxyInfo.this ? proxyInfo.this : obj; }
	const unboxName = function(obj, fallbackName) { var proxyInfo = pts_map.get(obj); return proxyInfo ? proxyInfo.name : fallbackName; }

	//
	// Helper:
	// Returns true if `obj` is a proxy, 
	// or a prototype object whose properties have been wrapped, 
	// or a non-object value
	//
	
	const isAlreadyWrapped = function(obj) { 
		return (true_if_one_of_the_following_is_true
			|| obj === null 
			|| obj === undefined 
			|| (typeof(obj) != 'object' && typeof(obj) != 'function')
			|| pts_map.has(obj)
		);
	};

	//
	// Helper:
	// Returns true if `obj` is a desirable proxy/property wrapping candidate
	//

	const shouldBeWrapped = function(f) {
		return (true_if_all_of_the_following_are_true
			&& !isAlreadyWrapped(f) 
			&& isFromThisRealm(f) 
			&& !(~objectsToNeverWrapProperties.indexOf(f)) 
			&& isNativeObject(f)
		);
	}

	// ===============================================================
	// This is the algorithm we want to run when an API is being used
	// ===============================================================

	// CUSTOMIZE HERE:
	// this is where we will store our information, we will export it as window.log on the page
	var log = new Array();
	var add_log = function(name) {
		log.push(normalizeName(name));
	}
	/*
	var log = new Set();
	var add_log = function(name) {
		log.add(normalizeName(name));
	}
	*/

	var normalizeName = function(name) {
		return name.replace(/Prototype\./g,'.');
	}

	// this is how operations on the proxies will work:
	const proxyCode = {

		// =========================================================================================
		// this function is called when the page executes the following code:
		// returnValue = htmlElement.innerHTML (o = htmlElement, k = "innerHTML")
		// =========================================================================================
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
				// =========================================================================================
				let property = getPropertyDescriptorOf(o, k);
				if(property != null || returnValue !== undefined) {
					if(!property || !property.get || isNativeFunction(property.get)) {
						try { add_log(`${getNativePrototypeTypeOf(o,k)}.${getStringRepresentationOfKey(k)}`) } catch (ex) {/*debugger;*/};
					}
				}
				// =========================================================================================

			}

			// since we want to continue to receive usage info for the object we are about to return...
			if(returnValue && shouldBeWrapped(returnValue)) {

				// first, we need to know if we can wrap it in a proxy...

				let property = getPropertyDescriptorOf(o, k);
				let doesPropertyAllowProxyWrapping = !property || (property.set || property.writable) || property.configurable;

				if(doesPropertyAllowProxyWrapping) {

					// if we can, that is the best option
					returnValue = wrapInProxy(returnValue, `${unboxName(box(o), getNativeTypeOf(unbox(o)))}.${getStringRepresentationOfKey(k)}`);

				} else {

					// if not (rare) we will do our best by special-casing the object
					try { wrapPropertiesOf(returnValue, `${getNativePrototypeTypeOf(o,k)}.${getStringRepresentationOfKey(k)}`); } catch (ex) {/*debugger;*/}
				}

			}

			return returnValue;

		},

		// =========================================================================================
		// this function is called when the page executes the following code:
		// htmlElement.innerHTML = responseText; (o = htmlElement, k = "innerHTML", v = responseText)
		// =========================================================================================
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
				// =========================================================================================
				let property = getPropertyDescriptorOf(o, k);
				if(property != null) {
					if(!property.set || isNativeFunction(property.set)) {
						try {
							add_log(`${getNativePrototypeTypeOf(o,k)}.${getStringRepresentationOfKey(k)}=${getNativeTypeOf(v)}`)
						} catch (ex) {/*debugger;*/};
					}
				}
				// =========================================================================================

			}

			return true;
		},

		// =========================================================================================
		// this function is called when the page executes the following code:
		// returnValue = htmlElement.cloneNode(true); (o = htmlElement.cloneNode, t = htmlElement, a = [true])
		// =========================================================================================
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
				// =========================================================================================
				if(isNativeFunction(o)) {
					let func_name = `${unboxName(o,'')}`;
					if(!func_name && o.name && unbox((t||window)[o.name]) === o) { try {func_name = `${getNativePrototypeTypeOf(t||window,o.name)}.${getStringRepresentationOfKey(o.name)}`; } catch (ex) {/*debugger;*/}; }
					if(!func_name) { try { func_name = `${getNativeTypeOf(t||window)}.[???]}`; } catch (ex) {/*debugger;*/}; }
					try { func_name = `${func_name}(${a.map(x=>getNativeTypeOf(x)).join(',')})`; } catch (ex) { /*debugger;*/ };
					try { add_log(`${func_name}`) } catch (ex) {}
				}
				// =========================================================================================
			}

			return wrapInProxy(returnValue,o.name+'()');

		},

		// =========================================================================================
		// this function is called when the page executes the following code:
		// returnValue = new CustomEvent("click"); (o = CustomEvent, a = ["click"])
		// =========================================================================================
		construct(o,a) {

			// special rule: if we are calling a native function, none of the arguments can be proxies
			if(isNativeFunction(o)) {
				a=a.map(a => unbox(a));
			}

			try {

				// if we want to measure how long this operation took:
				//var operationTime = -performance.now()

				// create a new instance of the object, and return it
				var returnValue = Reflect.construct(o,a);

			} finally {

				// if we want to know how long this operation took:
				//operationTime += performance.now();

				// CUSTOMIZE HERE:
				// =========================================================================================
				if(isNativeFunction(o)) {
					let func_name = `${unboxName(o,'')}`;
					if(!func_name && o.name) { try {func_name = `${getStringRepresentationOfKey(o.name)}`; } catch (ex) {/*debugger;*/}; }
					if(!func_name) { try { func_name = `${getNativeTypeOf(returnValue)}`; } catch (ex) {/*debugger;*/}; }
					try { func_name = `new ${func_name}`; } catch (ex) { /*debugger;*/ };
					try { func_name = `${func_name}(${a.map(x=>getNativeTypeOf(x)).join(',')})`; } catch (ex) { /*debugger;*/ };
					try { add_log(`${func_name}`) } catch (ex) {}
				}
				// =========================================================================================

			}

			return wrapInProxy(returnValue, 'new ' + o.name + '()');

		}
	};

	//
	// Helper:
	// Creates a proxy for the given source object and name, if needed (and return it)
	//

	const wrapInProxy = function(obj,name) {

		// special rule: non-objects do not need a proxy
		if(obj === null) return obj;
		if(obj === undefined) return obj;
		if(!(typeof(obj) == 'function' || typeof(obj) == 'object')) return obj;

		// special rule: some objects should never be wrapped, return them directly
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

		// do not wrap non-native objects
		if(!shouldBeWrapped(obj)) { /*debugger;*/ return obj; }

		// wrap the object in proxy, and add some metadata
		try {

			let pxy = new Proxy(obj, proxyCode);
			stp_map.set(obj, pxy);
			pts_map.set(pxy, { this: obj, name: name });
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

	const wrapPropertiesOf = function(obj, name) {

		// special rule: don't rewrap a wrapped object
		if(isAlreadyWrapped(obj)) return;

		// mark the object as wrapped already
		pts_map.set(obj, { this: obj, name: name });

		// wrap the properties of all prototypes
		let proto = Object.getPrototypeOf(obj);
		while(proto && !isAlreadyWrapped(proto)) {
			wrapPropertiesOf(proto, proto.constructor ? proto.constructor.name : undefined);
			proto = Object.getPrototypeOf(proto);
		}

		// special rule: some objects should never be wrapped, return them directly
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

							// =========================================================================================
							// this function is called when the page executes the following code:
							// returnValue = obj.property (this = obj, key = "property")
							// =========================================================================================
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
									// =========================================================================================
									if(isNativeFunction(property.get)) {
										try { add_log(`${getNativeTypeOf(proto)}.${getStringRepresentationOfKey(key)}`) } catch (ex) {/*debugger;*/};
									}
									// =========================================================================================

								}

								return wrapInProxy(returnValue, name+'.'+key);

							},

							// =========================================================================================
							// this function is called when the page executes the following code:
							// obj.property = newValue (this = obj, key = "property", v = newValue)
							// =========================================================================================
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
									// =========================================================================================
									if(isNativeFunction(property.set)) {
										try { add_log(`${getNativeTypeOf(proto)}.${getStringRepresentationOfKey(key)}=${getNativeTypeOf(v)}`); } catch (ex) {/*debugger;*/};
									}
									// =========================================================================================

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
							console.warn("Unable to wrap readonly property at this level: ", obj, name, key);
						}

					} else if(proto === obj) {

						if(key != 'URLUnencoded') { // HACK: Edge hack
							console.warn("Unable to wrap strange property: ", obj, name, key);
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
						console.warn("Unable to wrap readonly property: ", obj, name, key);
					}

				} else {

					// wtf?
					if(key != 'URLUnencoded') { // HACK: Edge hack
						console.warn("Unable to wrap strange property: ", obj, name, key);
						/*debugger;*/
					}

				}

			} catch (ex) {

				console.warn("Unable to wrap property: ", obj, name, key, ex);

			}
		}
		
	}

	//
	// There are a few objects we don't want to wrap for performance reason
	//

	const objectsToNeverWrapInProxy = [
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
	const objectsToNeverWrapProperties = [
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
	for(let key of Object.getOwnPropertyNames(window)) {
		if(typeof(key) == 'string' && ~key.indexOf('Array')) {
			objectsToNeverWrapInProxy.push(window[key]);
			objectsToNeverWrapProperties.push(window[key]);
			if(window[key].prototype) {
				objectsToNeverWrapInProxy.push(window[key].prototype);
				objectsToNeverWrapProperties.push(window[key].prototype);
			}
		}
	}

	// add special support for "call" and "apply"
	const functionCall = Function.prototype.call;
	const functionApply = Function.prototype.apply;
	functionToString.call = functionCall.call = functionApply.call = functionCall;
	functionToString.apply = functionCall.apply = functionApply.apply = functionApply;
	Function.prototype.call = function(obj, ...args) {
		return wrapInProxy(functionCall.call(this, obj, ...args));
	}
	Function.prototype.apply = function(obj, args) {
		return wrapInProxy(functionCall.call(this, obj, ...args));
	}

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
	// Expose our findings in the global scope or in the console
	//

	// CUSTOMIZE HERE:
	// =========================================================================================

	window.log = log;
	log.length = 0;
	/*log.clear();*/

	// =========================================================================================

}();
