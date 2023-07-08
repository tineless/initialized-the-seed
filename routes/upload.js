router.all(/^\/Upload$/, async(req, res, next) => {
	if(!['POST', 'GET'].includes(req.method)) return next();
	
	const licelst = await curs.execute("select title from documents where namespace = '틀' and title like '이미지 라이선스/%' order by title");
	const catelst = await curs.execute("select title from documents where namespace = '분류' and title like '파일/%' order by title");
	
	var liceopts = '', cateopts = '';
	
	for(var lice of licelst) {
		liceopts += `<option value="${html.escape('' + totitle(lice.title, '틀'))}"${lice.title == '이미지 라이선스/제한적 이용' ? ' selected' : ''}>${html.escape(lice.title.replace('이미지 라이선스/', ''))}</option>`;
	}
	for(var cate of catelst) {
		cateopts += `<option value="${html.escape('' + totitle(cate.title, '분류'))}">${html.escape(cate.title.replace('파일/', ''))}</option>`;
	}
	
	var content = '';
	
	content = `
		<form method=post id=uploadForm enctype=multipart/form-data accept-charset=utf8>
			<input type=hidden name=baserev value=0 />
			<input type="file" id="fileInput" name=file hidden />
			<input type=hidden name=identifier value="${islogin(req) ? 'm' : 'i'}:${html.escape(ip_check(req))}" />
			
			<div class=row>
				<div class="col-xs-12 col-md-7 form-group">
					<label class=control-label for=fakeFileInput>파일 선택</label>
					<div class=input-group>
						<input type=text class=form-control id=fakeFileInput readonly />
						<span class="input-group-btn">
							<button class="btn btn-secondary" type=button id=fakeFileButton>Select</button>
						</span>
					</div>
				</div>
			</div>
			
			<div class=row>
				<div class="col-xs-12 col-md-7 form-group">
					<label class=control-label for=fakeFileInput>파일 이름</label>
					<input type=text class=form-control name=document id=documentInput value="${html.escape(req.method == 'POST' ? req.body['document'] : '')}" />
				</div>
			</div>

			<textarea name=text type=text rows=25 id=textInput class=form-control>${(req.method == 'POST' ? req.body['text'] : '').replace(/<\/(textarea)>/gi, '&lt;/$1&gt;')}</textarea>
		${req.method == 'GET' ? `
			<div class=row>
				<div class="col-xs-12 col-md-5 form-group">
					<label class=control-label for=licenseSelect>라이선스</label>
					<select id=licenseSelect class=form-control>${ liceopts }</select>
				</div>
			</div>
			
			<p style="font-weight: bold; color: red;">[주의!] 파일문서의 라이선스(문서 본문)와 올리는 파일의 라이선스는 다릅니다. 파일의 라이선스를 올바르게 지정하였는지 확인하세요.</p>
			
			<div class=row>
				<div class="col-xs-12 col-md-5 form-group">
					<label class=control-label for=categorySelect>분류</label>
					<select id=categorySelect class=form-control>
						<option value>선택</option>
						${cateopts}
					</select>
				</div>
			</div>
		` : ''}
			<div class=form-group>
				<label class=control-label>요약</label>
				<input type=text id=logInput class=form-control name=log value="${html.escape(req.method == 'POST' ? req.body['log'] : '')}" />
			</div>
			
			<p>${config.getString('wiki.editagree_text', `문서 편집을 <strong>저장</strong>하면 당신은 기여한 내용을 <strong>CC-BY-NC-SA 2.0 KR</strong>으로 배포하고 기여한 문서에 대한 하이퍼링크나 URL을 이용하여 저작자 표시를 하는 것으로 충분하다는 데 동의하는 것입니다. 이 <strong>동의는 철회할 수 없습니다.</strong>`)}</p>
			
			${islogin(req) ? '' : `<p style="font-weight: bold;">비로그인 상태로 편집합니다. 편집 역사에 IP(${ip_check(req)})가 영구히 기록됩니다.</p>`}
			
			<div class=btns>
				<button id=uploadBtn type=submit class="btn btn-primary">올리기</button>
			</div>
		</form>
		
		<script>uploadInit();</script>
	`;
	
	var error = null;
	
	if(req.method == 'POST') do {
		var file = req.files[0];
		if(!file) { content = (error = err('alert', { code: 'file_not_uploaded' })) + content; break; }
		var title = req.body['document'];
		if(!title) { content = (error = err('alert', { code: 'validator_required', tag: 'document' })) + content; break; }
		var doc = processTitle(title);
		if(doc.namespace != '파일') { content = (error = err('alert', { msg: '업로드는 파일 이름 공간에서만 가능합니다.' })) + content; break; }
		if(path.extname(doc.title).toLowerCase() != path.extname(file.originalname).toLowerCase()) {
			content = (error = err('alert', { msg: '문서 이름과 확장자가 맞지 않습니다.' })) + content;
			break;
		}
		var aclmsg = await getacl(req, doc.title, doc.namespace, 'edit', 1);
		if(aclmsg) { content = (error = err('alert', { code: 'permission_edit', msg: aclmsg })) + content; break; }
		
		if(error) break;
		
		const response = res;
		
		var request = http.request({
			method: 'POST', 
			host: hostconfig.image_host,
			port: hostconfig.image_port,
			path: '/upload',
			headers: {
				'Content-Type': 'application/json',
			},
		}, async res => {
			var data = '';
			res.on('data', d => data += d);
			res.on('end', async () => {
				data = JSON.parse(data);
				if(data.status != 'success') {
					error = err('alert', { code: 'file_not_uploaded' });
					return response.send(await render(req, '파일 올리기', error + content, {}, _, error, 'upload'));
				}
				await curs.execute("insert into files (title, namespace, hash) values (?, ?, ?)", [doc.title, doc.namespace, '']);  // sha224 해시화 필요
				return response.redirect('/w/' + totitle(doc.title, doc.namespace));
			});
		}).on('error', async e => {
			error = err('alert', { msg: '파일 서버가 사용가능하지 않습니다.' });
			return res.send(await render(req, '파일 올리기', error + content, {}, _, error, 'upload'));
		});
		request.write(JSON.stringify({
			filename: file.originalname,
			document: title,
			mimetype: file.mimetype,
			file: file.buffer.toString('base64'),
		}));
		request.end();
		
		return;
	} while(0);
	
	res.send(await render(req, '파일 올리기', content, {}, _, error, 'upload'));
});