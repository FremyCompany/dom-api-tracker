// test 1
var a = document.createElement('a');
a.href = 'http://google.be/favicon.ico';
a.download = true;
a.__expando = {
	__shouldNotBeDetected: function() {
		document.title = 'Testing API Tracking';
	}
};
a.__expando.__shouldNotBeDetected();
document.body.appendChild(a);
if(document.body.lastChild !== a) {
	console.warn('error in code');
}
getComputedStyle(a).color;
a.remove();

// test2
var o = new Option();
o.textContent = 'option';
o.defaultSelected = true;