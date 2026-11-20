// Preserve access to legacy football hash bookmarks on the preview host.
if (location.hash && location.hash !== '#main') location.replace('/football/' + location.hash);
