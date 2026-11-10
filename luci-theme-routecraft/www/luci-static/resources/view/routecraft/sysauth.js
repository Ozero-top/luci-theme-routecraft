'use strict';'require ui';'require view';return view.extend({render:function(){var section=document.querySelector('section'),form=document.querySelector('form'),btn=document.querySelector('button.important'),view=document.getElementById('view');if(view)
view.style.display='none';if(section)
section.hidden=false;if(form&&btn){form.addEventListener('keypress',function(ev){if(ev.key==='Enter'){ev.preventDefault();btn.click();}});btn.addEventListener('click',function(){btn.disabled=true;btn.classList.add('spinning');btn.textContent=_('Logging in…');form.submit();});var pw=document.querySelector('input[type="password"]');if(pw)
pw.focus();}
return E([]);},addFooter:function(){}});
