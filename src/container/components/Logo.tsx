import React from 'react'
import { Tooltip } from 'antd'
import { useSelector } from 'react-redux'

// Logo blanc ChapsVision — lisible sur le panneau latéral sombre.
import LogoBlanc from '../../../assets/logo_blanc.svg'

import { IAppInfo, IRootState } from '../interface'

const LogoMenu: React.FunctionComponent<{}> = () => {
	const app = useSelector<IRootState, IAppInfo>((state) => state.app)

	return (
		<Tooltip title={`${app.name} ${app.version}`}>
			<div id="e-launcher-logo">
				<img src={LogoBlanc} alt="LOGO" />
			</div>
		</Tooltip>
	)
}

export default LogoMenu
