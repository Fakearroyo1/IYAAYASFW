(function(){
 var media=window.matchMedia('(prefers-color-scheme: dark)');
 function apply(){var mode='system';try{var saved=localStorage.getItem('supply-theme');if(['light','dark','system'].indexOf(saved)!==-1)mode=saved;}catch(e){}document.documentElement.dataset.theme=mode;document.documentElement.classList.toggle('dark',mode==='dark'||mode==='system'&&media.matches);window.dispatchEvent(new Event('supply-theme-changed'));}
 apply();media.addEventListener('change',apply);window.addEventListener('storage',function(e){if(e.key==='supply-theme')apply();});
})();
